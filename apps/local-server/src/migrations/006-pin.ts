export const migration = `
ALTER TABLE auth_sessions ADD COLUMN audience TEXT NOT NULL DEFAULT 'LEGACY_POS' CHECK(audience IN ('LEGACY_POS','CASHIER_POS','LOCAL_ADMIN','WAITER_WEB'));
ALTER TABLE auth_sessions ADD COLUMN method TEXT NOT NULL DEFAULT 'PASSWORD' CHECK(method IN ('PASSWORD','PIN'));
UPDATE auth_sessions SET revoked=1;
CREATE TABLE pin_key_binding (singleton INTEGER PRIMARY KEY CHECK(singleton=1), fingerprint TEXT NOT NULL) STRICT;
CREATE TRIGGER pin_binding_no_update BEFORE UPDATE ON pin_key_binding BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PIN_BINDING'); END;
CREATE TRIGGER pin_binding_no_delete BEFORE DELETE ON pin_key_binding BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PIN_BINDING'); END;
CREATE TABLE employee_pins (
 employee_id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 lookup TEXT NOT NULL, hash TEXT NOT NULL, ciphertext TEXT NOT NULL,
 UNIQUE(branch_id,lookup), FOREIGN KEY(branch_id,employee_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TRIGGER pin_employee_scope BEFORE INSERT ON employee_pins WHEN NOT EXISTS(SELECT 1 FROM employees WHERE id=NEW.employee_id AND branch_id=NEW.branch_id AND role IN ('CASHIER','WAITER') AND status!='DEACTIVATED') BEGIN SELECT RAISE(ABORT,'PIN_TARGET_INVALID'); END;
CREATE TRIGGER pin_scope_immutable BEFORE UPDATE ON employee_pins WHEN NEW.employee_id!=OLD.employee_id OR NEW.branch_id!=OLD.branch_id OR NEW.version<=OLD.version BEGIN SELECT RAISE(ABORT,'PIN_VERSION_INVALID'); END;
CREATE TRIGGER employee_pin_retire AFTER UPDATE OF role,status ON employees WHEN NEW.status='DEACTIVATED' OR NEW.role!=OLD.role BEGIN DELETE FROM employee_pins WHERE employee_id=NEW.id; END;
CREATE TABLE pin_attempts (identity TEXT PRIMARY KEY, count INTEGER NOT NULL, window_at INTEGER NOT NULL, retry_after INTEGER NOT NULL, strikes INTEGER NOT NULL) STRICT;
`;
