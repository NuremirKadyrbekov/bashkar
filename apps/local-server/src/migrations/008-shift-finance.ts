// Append-only financial adjustments and closure facts. Existing migrations are immutable.
export const migration = `
CREATE TABLE refunds (
 id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,payment_id TEXT NOT NULL,settlement_id TEXT NOT NULL,order_id TEXT NOT NULL,
 original_shift_id TEXT NOT NULL,shift_id TEXT NOT NULL,method TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),
 reason TEXT NOT NULL CHECK(length(reason)>0),external_return_confirmed INTEGER NOT NULL CHECK(external_return_confirmed=1),
 actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,created_at INTEGER NOT NULL,command_id TEXT NOT NULL,
 UNIQUE(branch_id,id),UNIQUE(branch_id,payment_id),UNIQUE(branch_id,command_id),
 FOREIGN KEY(branch_id,payment_id) REFERENCES payments(branch_id,id),FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id),
 FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TRIGGER refund_source BEFORE INSERT ON refunds WHEN NOT EXISTS(
 SELECT 1 FROM payments p JOIN settlement_seals z ON z.branch_id=p.branch_id AND z.settlement_id=p.settlement_id
 JOIN shifts s ON s.branch_id=p.branch_id AND s.id=NEW.shift_id AND s.status='OPEN'
 WHERE p.branch_id=NEW.branch_id AND p.id=NEW.payment_id AND p.order_id=NEW.order_id AND p.settlement_id=NEW.settlement_id
 AND p.shift_id=NEW.original_shift_id AND p.method=NEW.method AND p.amount=NEW.amount)
 BEGIN SELECT RAISE(ABORT,'PAYMENT_NOT_REFUNDABLE'); END;
CREATE INDEX orders_shift_finance ON orders(branch_id,shift_id,status);
CREATE INDEX payments_shift_finance ON payments(branch_id,shift_id);
CREATE INDEX settlements_shift_finance ON settlements(branch_id,shift_id);
CREATE INDEX refunds_shift ON refunds(branch_id,shift_id,method);
CREATE TABLE payment_incident_resolutions (
 id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,incident_id TEXT NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN ('MATCHED_SETTLEMENT','EXTERNAL_RETURN')),
 shift_id TEXT NOT NULL,settlement_id TEXT,details TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,created_at INTEGER NOT NULL,command_id TEXT NOT NULL,
 UNIQUE(branch_id,id),UNIQUE(branch_id,incident_id),UNIQUE(branch_id,command_id),
 CHECK((outcome='MATCHED_SETTLEMENT' AND settlement_id IS NOT NULL) OR (outcome='EXTERNAL_RETURN' AND settlement_id IS NULL)),
 FOREIGN KEY(branch_id,incident_id) REFERENCES payment_incidents(branch_id,id),FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id),
 FOREIGN KEY(branch_id,settlement_id) REFERENCES settlements(branch_id,id),FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE incident_receipt_matches (
 branch_id TEXT NOT NULL,resolution_id TEXT NOT NULL,receipt_index INTEGER NOT NULL CHECK(receipt_index>=0),payment_id TEXT NOT NULL,
 source_key TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),PRIMARY KEY(resolution_id,receipt_index),UNIQUE(branch_id,source_key),
 FOREIGN KEY(branch_id,resolution_id) REFERENCES payment_incident_resolutions(branch_id,id),FOREIGN KEY(branch_id,payment_id) REFERENCES payments(branch_id,id)
) STRICT;
CREATE TABLE financial_cases (
 id TEXT PRIMARY KEY,branch_id TEXT NOT NULL REFERENCES activation(branch_id),kind TEXT NOT NULL CHECK(kind IN ('RECOVERY_REVIEW','EXTERNAL_REFUND_DISPUTE')),
 blocking_shift_id TEXT,original_shift_id TEXT,order_id TEXT,payment_id TEXT,source_command_id TEXT,details TEXT NOT NULL,
 actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,created_at INTEGER NOT NULL,command_id TEXT NOT NULL,
 UNIQUE(branch_id,id),UNIQUE(branch_id,command_id),FOREIGN KEY(branch_id,blocking_shift_id) REFERENCES shifts(branch_id,id),
 FOREIGN KEY(branch_id,original_shift_id) REFERENCES shifts(branch_id,id),FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
 FOREIGN KEY(branch_id,payment_id) REFERENCES payments(branch_id,id),FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE INDEX financial_cases_branch ON financial_cases(branch_id,blocking_shift_id);
CREATE UNIQUE INDEX shifts_status_identity ON shifts(branch_id,id,status);
CREATE TABLE shift_reports (
 id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,shift_id TEXT NOT NULL,schema_version INTEGER NOT NULL CHECK(schema_version=1),metrics_version INTEGER NOT NULL CHECK(metrics_version=1),
 snapshot TEXT NOT NULL,sha256 TEXT NOT NULL CHECK(length(sha256)=64),created_at INTEGER NOT NULL,
 UNIQUE(branch_id,id),UNIQUE(branch_id,shift_id),UNIQUE(branch_id,id,shift_id),
 FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id),
 FOREIGN KEY(branch_id,shift_id,id) REFERENCES shift_closures(branch_id,shift_id,report_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE shift_closures (
 shift_id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,closed_by TEXT NOT NULL,closed_by_name TEXT NOT NULL,closed_at INTEGER NOT NULL,command_id TEXT NOT NULL,report_id TEXT NOT NULL UNIQUE,closed_status TEXT NOT NULL DEFAULT 'CLOSED' CHECK(closed_status='CLOSED'),
 UNIQUE(branch_id,shift_id),UNIQUE(branch_id,command_id),UNIQUE(branch_id,shift_id,report_id),
 FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id),FOREIGN KEY(branch_id,closed_by) REFERENCES employees(branch_id,id),FOREIGN KEY(branch_id,shift_id,closed_status) REFERENCES shifts(branch_id,id,status) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(branch_id,report_id,shift_id) REFERENCES shift_reports(branch_id,id,shift_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TRIGGER closure_open BEFORE INSERT ON shift_closures WHEN NOT EXISTS(SELECT 1 FROM shifts WHERE id=NEW.shift_id AND branch_id=NEW.branch_id AND status='OPEN')
 BEGIN SELECT RAISE(ABORT,'SHIFT_NOT_OPEN'); END;
CREATE TRIGGER shift_closure_required BEFORE UPDATE OF status ON shifts WHEN NEW.status='CLOSED' AND NOT EXISTS(
 SELECT 1 FROM shift_closures c JOIN shift_reports r ON r.id=c.report_id AND r.branch_id=c.branch_id AND r.shift_id=c.shift_id WHERE c.shift_id=NEW.id AND c.branch_id=NEW.branch_id)
 BEGIN SELECT RAISE(ABORT,'SHIFT_REPORT_REQUIRED'); END;
CREATE TRIGGER shift_blockers BEFORE UPDATE OF status ON shifts WHEN NEW.status='CLOSED' AND (
 EXISTS(SELECT 1 FROM table_sessions WHERE branch_id=NEW.branch_id AND status='OPEN') OR EXISTS(SELECT 1 FROM orders WHERE branch_id=NEW.branch_id AND status='OPEN') OR EXISTS(SELECT 1 FROM financial_cases WHERE branch_id=NEW.branch_id) OR EXISTS(SELECT 1 FROM payment_incidents i LEFT JOIN payment_incident_resolutions r ON r.incident_id=i.id AND r.branch_id=i.branch_id WHERE i.branch_id=NEW.branch_id AND r.id IS NULL))
 BEGIN SELECT RAISE(ABORT,'SHIFT_CLOSE_BLOCKED'); END;
CREATE TRIGGER closed_shift_immutable BEFORE UPDATE ON shifts WHEN OLD.status='CLOSED' OR OLD.id IS NOT NEW.id OR OLD.branch_id IS NOT NEW.branch_id OR OLD.opened_by IS NOT NEW.opened_by OR OLD.opened_at IS NOT NEW.opened_at
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CLOSED_SHIFT'); END;
CREATE TRIGGER shifts_no_delete BEFORE DELETE ON shifts BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHIFT_HISTORY'); END;
${['refunds','payment_incident_resolutions','incident_receipt_matches','financial_cases','shift_reports','shift_closures'].map(t=>`
CREATE TRIGGER ${t}_immutable_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_FACT'); END;
CREATE TRIGGER ${t}_immutable_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_FACT'); END;`).join('')}
${['refunds','payment_incident_resolutions','payment_incidents','orders','order_corrections','settlements','payments','table_sessions'].map(t=>`
CREATE TRIGGER ${t}_open_shift BEFORE INSERT ON ${t} WHEN NOT EXISTS(SELECT 1 FROM shifts WHERE branch_id=NEW.branch_id AND id=NEW.shift_id AND status='OPEN')
 BEGIN SELECT RAISE(ABORT,'SHIFT_NOT_OPEN'); END;`).join('')}
CREATE TRIGGER batch_open_shift BEFORE INSERT ON order_batches WHEN NOT EXISTS(SELECT 1 FROM orders o JOIN shifts s ON s.branch_id=o.branch_id AND s.id=o.shift_id WHERE o.id=NEW.order_id AND o.branch_id=NEW.branch_id AND o.status='OPEN' AND s.status='OPEN')
 BEGIN SELECT RAISE(ABORT,'SHIFT_NOT_OPEN'); END;
CREATE TRIGGER order_closed_shift BEFORE UPDATE ON orders WHEN NOT EXISTS(SELECT 1 FROM shifts WHERE branch_id=OLD.branch_id AND id=OLD.shift_id AND status='OPEN')
 BEGIN SELECT RAISE(ABORT,'SHIFT_NOT_OPEN'); END;
CREATE TRIGGER case_open_shift BEFORE INSERT ON financial_cases WHEN NEW.blocking_shift_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shifts WHERE id=NEW.blocking_shift_id AND branch_id=NEW.branch_id AND status='OPEN')
 BEGIN SELECT RAISE(ABORT,'SHIFT_NOT_OPEN'); END;
`;
