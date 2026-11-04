// Assignment changes are append-only. Opening identity and financial history stay immutable.
export const migration=`
CREATE TABLE table_assignment_events (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, session_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>1),
 kind TEXT NOT NULL CHECK(kind IN ('MOVE','RESPONSIBLE')),
 before_table_id TEXT, after_table_id TEXT, before_table_name TEXT NOT NULL, after_table_name TEXT NOT NULL,
 before_zone_name TEXT NOT NULL, after_zone_name TEXT NOT NULL,
 before_waiter_id TEXT, after_waiter_id TEXT, before_waiter_name TEXT, after_waiter_name TEXT,
 actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, command_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(branch_id,session_id,revision), UNIQUE(branch_id,command_id),
 FOREIGN KEY(branch_id,session_id) REFERENCES table_sessions(branch_id,id),
 FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id),
 FOREIGN KEY(branch_id,after_waiter_id) REFERENCES employees(branch_id,id),
 FOREIGN KEY(branch_id,after_table_id) REFERENCES dining_tables(branch_id,id)
) STRICT;
CREATE TRIGGER assignment_valid BEFORE INSERT ON table_assignment_events WHEN NOT EXISTS(
 SELECT 1 FROM table_sessions v JOIN shifts s ON s.branch_id=v.branch_id AND s.id=v.shift_id
 WHERE v.branch_id=NEW.branch_id AND v.id=NEW.session_id AND v.status='OPEN' AND s.status='OPEN'
 AND v.revision+1=NEW.revision AND v.table_id IS NEW.before_table_id AND v.table_name=NEW.before_table_name
 AND v.zone_name=NEW.before_zone_name AND v.responsible_waiter_id IS NEW.before_waiter_id AND v.responsible_waiter_name IS NEW.before_waiter_name
 AND ((NEW.kind='MOVE' AND NEW.before_table_id IS NOT NEW.after_table_id
 AND NEW.before_waiter_id IS NEW.after_waiter_id AND NEW.before_waiter_name IS NEW.after_waiter_name
 AND EXISTS(SELECT 1 FROM dining_tables t JOIN dining_zones z ON z.branch_id=t.branch_id AND z.id=t.zone_id
 WHERE t.branch_id=v.branch_id AND t.id=NEW.after_table_id AND t.active=1 AND z.active=1 AND t.name=NEW.after_table_name AND z.name=NEW.after_zone_name)
 AND NOT EXISTS(SELECT 1 FROM table_sessions occupied WHERE occupied.branch_id=v.branch_id AND occupied.table_id=NEW.after_table_id AND occupied.status='OPEN'))
 OR (NEW.kind='RESPONSIBLE' AND NEW.before_table_id IS NEW.after_table_id AND NEW.before_table_name=NEW.after_table_name AND NEW.before_zone_name=NEW.after_zone_name
 AND ((NEW.after_waiter_id IS NOT NULL AND EXISTS(SELECT 1 FROM employees e WHERE e.branch_id=v.branch_id AND e.id=NEW.after_waiter_id AND e.role='WAITER' AND e.status='ACTIVE' AND e.name=NEW.after_waiter_name))
 OR (NEW.after_waiter_id IS NULL AND NEW.after_waiter_name IS NULL AND NOT EXISTS(SELECT 1 FROM employees e WHERE e.branch_id=v.branch_id AND e.role='WAITER' AND e.status='ACTIVE')))))
) BEGIN SELECT RAISE(ABORT,'INVALID_VISIT_ASSIGNMENT'); END;
CREATE TRIGGER assignment_no_update BEFORE UPDATE ON table_assignment_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ASSIGNMENT_EVENT'); END;
CREATE TRIGGER assignment_no_delete BEFORE DELETE ON table_assignment_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ASSIGNMENT_EVENT'); END;
DROP TRIGGER table_session_history;
DROP TRIGGER visit_assignment_valid;
CREATE TRIGGER table_session_history BEFORE UPDATE ON table_sessions WHEN
 OLD.branch_id IS NOT NEW.branch_id OR OLD.id IS NOT NEW.id OR OLD.shift_id IS NOT NEW.shift_id OR
 OLD.opened_by IS NOT NEW.opened_by OR OLD.opened_by_name IS NOT NEW.opened_by_name OR OLD.opened_at IS NOT NEW.opened_at OR
 OLD.status='CLOSED' OR NEW.revision<>OLD.revision+1 OR
 NEW.has_accepted_batch<OLD.has_accepted_batch OR NEW.has_registered_payment<OLD.has_registered_payment OR
 ((OLD.table_id IS NOT NEW.table_id OR OLD.table_name IS NOT NEW.table_name OR OLD.zone_name IS NOT NEW.zone_name OR
 OLD.responsible_waiter_id IS NOT NEW.responsible_waiter_id OR OLD.responsible_waiter_name IS NOT NEW.responsible_waiter_name) AND
 (NEW.status<>'OPEN' OR NOT EXISTS(SELECT 1 FROM table_assignment_events e WHERE e.branch_id=OLD.branch_id AND e.session_id=OLD.id AND e.revision=NEW.revision
 AND e.before_table_id IS OLD.table_id AND e.after_table_id IS NEW.table_id AND e.before_table_name=OLD.table_name AND e.after_table_name=NEW.table_name
 AND e.before_zone_name=OLD.zone_name AND e.after_zone_name=NEW.zone_name AND e.before_waiter_id IS OLD.responsible_waiter_id AND e.after_waiter_id IS NEW.responsible_waiter_id
 AND e.before_waiter_name IS OLD.responsible_waiter_name AND e.after_waiter_name IS NEW.responsible_waiter_name)))
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VISIT_HISTORY'); END;
`;
