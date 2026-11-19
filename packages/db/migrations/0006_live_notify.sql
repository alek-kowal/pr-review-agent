-- S-03-T1: every insert or update on a table the UI watches sends one `pra_change` notification
-- with a small JSON payload {table, id, prId, runId}. Hand-written (drizzle-kit --custom): the
-- schema files do not describe functions or triggers. Postgres folds identical payloads sent in
-- one transaction, so a statement that touches a row twice notifies once.
CREATE OR REPLACE FUNCTION pra_notify_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec jsonb := to_jsonb(NEW);
  v_pr integer := (rec ->> 'pull_request_id')::integer;
  v_run integer := (rec ->> 'run_id')::integer;
BEGIN
  IF TG_TABLE_NAME = 'pull_requests' THEN
    v_pr := (rec ->> 'id')::integer;
  ELSIF TG_TABLE_NAME = 'runs' THEN
    v_run := (rec ->> 'id')::integer;
  ELSIF TG_TABLE_NAME = 'agent_sessions' THEN
    SELECT se.run_id INTO v_run FROM stage_executions se
      WHERE se.id = (rec ->> 'stage_execution_id')::integer;
  END IF;
  IF v_pr IS NULL AND v_run IS NOT NULL THEN
    SELECT r.pull_request_id INTO v_pr FROM runs r WHERE r.id = v_run;
  END IF;
  PERFORM pg_notify(
    'pra_change',
    json_build_object('table', TG_TABLE_NAME, 'id', rec -> 'id', 'prId', v_pr, 'runId', v_run)::text
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pull_requests_notify_change AFTER INSERT OR UPDATE ON pull_requests
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();
--> statement-breakpoint
CREATE TRIGGER runs_notify_change AFTER INSERT OR UPDATE ON runs
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();
--> statement-breakpoint
CREATE TRIGGER stage_executions_notify_change AFTER INSERT OR UPDATE ON stage_executions
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();
--> statement-breakpoint
CREATE TRIGGER agent_sessions_notify_change AFTER INSERT OR UPDATE ON agent_sessions
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();
--> statement-breakpoint
CREATE TRIGGER findings_notify_change AFTER INSERT OR UPDATE ON findings
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();
--> statement-breakpoint
CREATE TRIGGER decision_batches_notify_change AFTER INSERT OR UPDATE ON decision_batches
  FOR EACH ROW EXECUTE FUNCTION pra_notify_change();
