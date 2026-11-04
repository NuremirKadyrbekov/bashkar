export const migration = `
CREATE TABLE waiter_session_security (
 session_id TEXT PRIMARY KEY REFERENCES auth_sessions(id),branch_id TEXT NOT NULL,employee_id TEXT NOT NULL,device_id TEXT NOT NULL,
 csrf_hash TEXT NOT NULL,unlock_hash TEXT NOT NULL,credential_version INTEGER NOT NULL,created_at INTEGER NOT NULL,
 FOREIGN KEY(branch_id,employee_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE web_key_binding (singleton INTEGER PRIMARY KEY CHECK(singleton=1),fingerprint TEXT NOT NULL) STRICT;
CREATE TABLE web_draft_key_contexts (
 branch_id TEXT NOT NULL,employee_id TEXT NOT NULL,device_id TEXT NOT NULL,key_version INTEGER NOT NULL CHECK(key_version=1),
 wrapped_key TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(branch_id,employee_id,device_id),
 FOREIGN KEY(branch_id,employee_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE waiter_network_revisions (
 revision INTEGER PRIMARY KEY,branch_id TEXT NOT NULL REFERENCES activation(branch_id),ip TEXT NOT NULL,port INTEGER NOT NULL,
 leaf_certificate TEXT NOT NULL,root_certificate TEXT NOT NULL,wrapped_private_key TEXT NOT NULL,root_fingerprint TEXT NOT NULL,
 leaf_fingerprint TEXT NOT NULL,valid_until INTEGER NOT NULL,actor_id TEXT NOT NULL,created_at INTEGER NOT NULL,
 command_id TEXT NOT NULL UNIQUE,FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
${['web_draft_key_contexts','waiter_network_revisions','web_key_binding'].map(t=>`
CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SECURITY_HISTORY'); END;
CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SECURITY_HISTORY'); END;`).join('')}
`;
