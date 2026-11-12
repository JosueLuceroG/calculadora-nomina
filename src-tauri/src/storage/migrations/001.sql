CREATE TABLE schema_version (id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL);
INSERT INTO schema_version VALUES(1, 1);
CREATE TABLE store_meta (id INTEGER PRIMARY KEY CHECK(id = 1), generation TEXT NOT NULL);
CREATE TABLE fiscal_packages (
  sha256 TEXT PRIMARY KEY CHECK(length(sha256) = 64),
  package_id TEXT NOT NULL, version TEXT NOT NULL, metadata_json TEXT NOT NULL
);
CREATE TABLE simulations (
  execution_id TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('gross-to-net','net-to-gross')),
  requested_amount TEXT NOT NULL, periodicity TEXT NOT NULL,
  reference_date TEXT NOT NULL, classification TEXT NOT NULL,
  gross TEXT, net TEXT,
  package_sha256 TEXT NOT NULL REFERENCES fiscal_packages(sha256),
  snapshot_version INTEGER NOT NULL CHECK(snapshot_version = 1),
  payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB)) <= 3145728),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64)
);
CREATE TABLE preferences (
  id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL CHECK(version = 1),
  theme TEXT NOT NULL CHECK(theme IN ('light','dark')),
  history_auto_save INTEGER NOT NULL CHECK(history_auto_save IN (0,1))
);
INSERT INTO preferences VALUES(1, 1, 'light', 0);
