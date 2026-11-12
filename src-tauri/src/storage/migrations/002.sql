CREATE TABLE deleted_executions (execution_id TEXT PRIMARY KEY);
CREATE INDEX simulations_date_id ON simulations(completed_at DESC, execution_id DESC);
UPDATE schema_version SET version = 2 WHERE id = 1;
