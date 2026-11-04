export const migration = `
CREATE TABLE storage_probe (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL) STRICT;
INSERT INTO storage_probe VALUES(1,'initialized');
CREATE TABLE activation (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), instance_id TEXT NOT NULL UNIQUE REFERENCES bootstrap_instance(id),
 branch_id TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL, owner_cloud_id TEXT NOT NULL,
 registration_id TEXT NOT NULL UNIQUE, proof TEXT NOT NULL, activated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE employees (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES activation(branch_id), login TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('OWNER','MANAGER','CASHIER','WAITER')),
 status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
 password_hash TEXT NOT NULL, must_change INTEGER NOT NULL CHECK(must_change IN (0,1)),
 credential_version INTEGER NOT NULL DEFAULT 1 CHECK(credential_version>0),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), created_at INTEGER NOT NULL,
 UNIQUE(branch_id,id)
) STRICT;
CREATE UNIQUE INDEX one_local_owner ON employees(branch_id) WHERE role='OWNER';
CREATE TABLE permission_overrides (
 employee_id TEXT NOT NULL REFERENCES employees(id), permission TEXT NOT NULL,
 allowed INTEGER NOT NULL CHECK(allowed IN (0,1)), PRIMARY KEY(employee_id,permission)
) STRICT;
CREATE TABLE manager_delegations (
 employee_id TEXT NOT NULL REFERENCES employees(id), permission TEXT NOT NULL,
 PRIMARY KEY(employee_id,permission)
) STRICT;
CREATE TABLE auth_sessions (
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), secret_hash TEXT NOT NULL UNIQUE,
 client TEXT NOT NULL CHECK(client IN ('POS','WAITER_WEB')), issued_at INTEGER NOT NULL,
 last_activity INTEGER NOT NULL, credential_version INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
) STRICT;
CREATE TABLE auth_attempts (identity TEXT PRIMARY KEY, failures INTEGER NOT NULL, retry_after INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE commands (
 branch_id TEXT NOT NULL REFERENCES activation(branch_id), id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES employees(id),
 fingerprint TEXT NOT NULL, result TEXT NOT NULL, committed_at INTEGER NOT NULL,
 PRIMARY KEY(branch_id,id), FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE audit_events (
 id TEXT PRIMARY KEY, branch_id TEXT, actor_id TEXT REFERENCES employees(id), action TEXT NOT NULL,
 target_id TEXT, result TEXT NOT NULL CHECK(result IN ('SUCCESS','DENIED','FAILED')),
 command_id TEXT, occurred_at INTEGER NOT NULL, details TEXT NOT NULL, FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE outbox (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES activation(branch_id), type TEXT NOT NULL, payload TEXT NOT NULL,
 created_at INTEGER NOT NULL, delivered_at INTEGER
) STRICT;
CREATE TABLE shifts (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED')),
 opened_by TEXT NOT NULL, opened_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(branch_id,opened_by) REFERENCES employees(branch_id,id)
) STRICT;
CREATE UNIQUE INDEX one_open_shift ON shifts(branch_id) WHERE status='OPEN';
CREATE TABLE menu_revisions (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES activation(branch_id), base_revision INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 document TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(branch_id,revision), FOREIGN KEY(branch_id,created_by) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE menu_current (branch_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, FOREIGN KEY(branch_id,revision) REFERENCES menu_revisions(branch_id,revision)) STRICT;
CREATE TABLE menu_drafts (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES activation(branch_id), base_revision INTEGER NOT NULL, revision INTEGER NOT NULL,
 document TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES employees(id), updated_at INTEGER NOT NULL, FOREIGN KEY(branch_id,updated_by) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE menu_availability (
 branch_id TEXT NOT NULL REFERENCES activation(branch_id), entity_id TEXT NOT NULL, available INTEGER NOT NULL CHECK(available IN (0,1)),
 revision INTEGER NOT NULL, PRIMARY KEY(branch_id,entity_id)
) STRICT;
CREATE TABLE branch_settings (branch_id TEXT PRIMARY KEY REFERENCES activation(branch_id), revision INTEGER NOT NULL, fees TEXT NOT NULL DEFAULT '[]') STRICT;
CREATE TRIGGER activation_no_update BEFORE UPDATE ON activation BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ACTIVATION'); END;
CREATE TRIGGER activation_no_delete BEFORE DELETE ON activation BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ACTIVATION'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUDIT'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AUDIT'); END;
CREATE TRIGGER command_no_update BEFORE UPDATE ON commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COMMAND'); END;
CREATE TRIGGER command_no_delete BEFORE DELETE ON commands BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COMMAND'); END;
CREATE TRIGGER menu_no_update BEFORE UPDATE ON menu_revisions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MENU'); END;
CREATE TRIGGER menu_no_delete BEFORE DELETE ON menu_revisions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MENU'); END;
`;
