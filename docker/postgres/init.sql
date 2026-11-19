-- Runs once, when the db volume is first created. `pra` comes from POSTGRES_DB.
-- `pra_test` is the maintenance database for tests: each test run creates and drops its own
-- `pra_test_<run>` database through it.
CREATE DATABASE pra_test;
