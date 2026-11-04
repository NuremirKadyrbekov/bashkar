export const migration=`
CREATE TABLE analytics_sync_state (
 branch_id TEXT PRIMARY KEY,settlement_rowid INTEGER NOT NULL DEFAULT 0,payment_rowid INTEGER NOT NULL DEFAULT 0,
 refund_rowid INTEGER NOT NULL DEFAULT 0,correction_rowid INTEGER NOT NULL DEFAULT 0,
 last_success_at INTEGER,last_error TEXT,
 FOREIGN KEY(branch_id) REFERENCES activation(branch_id)
) STRICT;
`;
