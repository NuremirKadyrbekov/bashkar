export const migration = `
CREATE TABLE table_cloud_sync_state (
 branch_id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 command_id TEXT NOT NULL,
 acknowledged_revision INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged_revision>=0),
 last_error TEXT,
 last_attempt_at INTEGER,
 last_success_at INTEGER,
 FOREIGN KEY(branch_id) REFERENCES activation(branch_id)
) STRICT;
`;
