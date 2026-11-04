export const migration = `
CREATE UNIQUE INDEX shifts_branch_identity ON shifts(branch_id,id);
CREATE TABLE table_settings (
 branch_id TEXT PRIMARY KEY REFERENCES activation(branch_id),
 mode TEXT NOT NULL CHECK(mode IN ('STRICT','SHARED')), revision INTEGER NOT NULL CHECK(revision>0)
) STRICT;
CREATE TABLE dining_zones (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES activation(branch_id),
 name TEXT NOT NULL, name_key TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
 revision INTEGER NOT NULL CHECK(revision>0), UNIQUE(branch_id,id), UNIQUE(branch_id,name_key)
) STRICT;
CREATE TABLE dining_tables (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES activation(branch_id), zone_id TEXT NOT NULL,
 name TEXT NOT NULL, name_key TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
 revision INTEGER NOT NULL CHECK(revision>0), UNIQUE(branch_id,id), UNIQUE(branch_id,name_key),
 FOREIGN KEY(branch_id,zone_id) REFERENCES dining_zones(branch_id,id)
) STRICT;
CREATE TABLE table_sessions (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, table_id TEXT NOT NULL, shift_id TEXT NOT NULL,
 opened_by TEXT NOT NULL, responsible_waiter_id TEXT,
 table_name TEXT NOT NULL, zone_name TEXT NOT NULL, opened_by_name TEXT NOT NULL, responsible_waiter_name TEXT,
 opened_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED')),
 closed_at INTEGER, closed_by TEXT, close_reason TEXT CHECK(close_reason IS NULL OR close_reason='EMPTY'),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 has_accepted_batch INTEGER NOT NULL DEFAULT 0 CHECK(has_accepted_batch IN (0,1)),
 has_registered_payment INTEGER NOT NULL DEFAULT 0 CHECK(has_registered_payment IN (0,1)),
 UNIQUE(branch_id,id),
 FOREIGN KEY(branch_id,table_id) REFERENCES dining_tables(branch_id,id),
 FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id),
 FOREIGN KEY(branch_id,opened_by) REFERENCES employees(branch_id,id),
 FOREIGN KEY(branch_id,responsible_waiter_id) REFERENCES employees(branch_id,id),
 FOREIGN KEY(branch_id,closed_by) REFERENCES employees(branch_id,id),
 CHECK((responsible_waiter_id IS NULL)=(responsible_waiter_name IS NULL)),
 CHECK((status='OPEN' AND closed_at IS NULL AND closed_by IS NULL AND close_reason IS NULL) OR
       (status='CLOSED' AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND close_reason='EMPTY' AND has_accepted_batch=0 AND has_registered_payment=0))
) STRICT;
CREATE UNIQUE INDEX one_active_visit_per_table ON table_sessions(branch_id,table_id) WHERE status='OPEN';
CREATE INDEX table_sessions_branch_shift ON table_sessions(branch_id,shift_id,status);
CREATE TRIGGER table_session_history BEFORE UPDATE ON table_sessions WHEN
 OLD.branch_id IS NOT NEW.branch_id OR OLD.id IS NOT NEW.id OR OLD.table_id IS NOT NEW.table_id OR
 OLD.shift_id IS NOT NEW.shift_id OR OLD.opened_by IS NOT NEW.opened_by OR
 OLD.responsible_waiter_id IS NOT NEW.responsible_waiter_id OR OLD.opened_at IS NOT NEW.opened_at OR
 OLD.table_name IS NOT NEW.table_name OR OLD.zone_name IS NOT NEW.zone_name OR
 OLD.opened_by_name IS NOT NEW.opened_by_name OR OLD.responsible_waiter_name IS NOT NEW.responsible_waiter_name OR
 OLD.status='CLOSED' OR NEW.revision<>OLD.revision+1 OR
 NEW.has_accepted_batch<OLD.has_accepted_batch OR NEW.has_registered_payment<OLD.has_registered_payment
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VISIT_HISTORY'); END;
CREATE TRIGGER table_session_no_delete BEFORE DELETE ON table_sessions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VISIT_HISTORY'); END;
CREATE TRIGGER table_config_occupied BEFORE UPDATE ON dining_tables WHEN EXISTS(
 SELECT 1 FROM table_sessions WHERE branch_id=OLD.branch_id AND table_id=OLD.id AND status='OPEN'
) BEGIN SELECT RAISE(ABORT,'TABLE_OCCUPIED'); END;
CREATE TRIGGER table_no_delete BEFORE DELETE ON dining_tables BEGIN SELECT RAISE(ABORT,'ARCHIVE_TABLE_REQUIRED'); END;
CREATE TRIGGER zone_no_delete BEFORE DELETE ON dining_zones BEGIN SELECT RAISE(ABORT,'ARCHIVE_ZONE_REQUIRED'); END;
`;
