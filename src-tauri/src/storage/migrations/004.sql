CREATE TABLE simulations_new (
  execution_id TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('gross-to-net','net-to-gross')),
  requested_amount TEXT NOT NULL, periodicity TEXT NOT NULL,
  reference_date TEXT NOT NULL, classification TEXT NOT NULL,
  gross TEXT, net TEXT,
  package_sha256 TEXT NOT NULL REFERENCES fiscal_packages(sha256),
  snapshot_version INTEGER NOT NULL CHECK(snapshot_version IN (1,2,3)),
  payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB)) <= 3145728),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64)
);
INSERT INTO simulations_new(execution_id,completed_at,direction,requested_amount,periodicity,reference_date,classification,gross,net,package_sha256,snapshot_version,payload,payload_sha256)
SELECT execution_id,completed_at,direction,requested_amount,periodicity,reference_date,classification,gross,net,package_sha256,snapshot_version,payload,payload_sha256 FROM simulations;
-- VERIFY_COPY_BEFORE_DROP
DROP TABLE simulations;
-- AFTER_DROP
ALTER TABLE simulations_new RENAME TO simulations;
CREATE INDEX simulations_date_id ON simulations(completed_at DESC,execution_id DESC);
UPDATE schema_version SET version=4 WHERE id=1;
PRAGMA user_version=4;
