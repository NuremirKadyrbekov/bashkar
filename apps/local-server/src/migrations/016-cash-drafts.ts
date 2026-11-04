// A parked basket is private to its cashier and is never an accepted order.
export const migration=`
CREATE TABLE cash_drafts (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, employee_id TEXT NOT NULL,
 shift_id TEXT NOT NULL, draft_number INTEGER NOT NULL CHECK(draft_number>0), revision INTEGER NOT NULL CHECK(revision>0),
 payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
 last_command_id TEXT NOT NULL, last_request_hash TEXT NOT NULL,
 UNIQUE(branch_id,shift_id,draft_number),
 FOREIGN KEY(branch_id,employee_id) REFERENCES employees(branch_id,id),
 FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id)
) STRICT;
CREATE INDEX cash_drafts_owner ON cash_drafts(branch_id,employee_id,updated_at DESC);
`;
