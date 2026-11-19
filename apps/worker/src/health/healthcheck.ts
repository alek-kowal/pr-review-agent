// Container healthcheck (`node dist/health/healthcheck.js` in deploy/compose.yaml): exits 0 when
// the worker's heartbeat file is fresh.
import { isHeartbeatFresh } from './heartbeat.ts';

const file = process.env.WORKER_HEARTBEAT_FILE;
process.exit(file && (await isHeartbeatFresh(file)) ? 0 : 1);
