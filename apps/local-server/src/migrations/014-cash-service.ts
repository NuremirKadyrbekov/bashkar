import {migration as finance} from './007-finance';
const visits=finance.slice(finance.indexOf('CREATE TABLE table_sessions'),finance.indexOf('CREATE TABLE orders'))
 .replace('table_id TEXT NOT NULL','table_id TEXT')
 .replace('UNIQUE(branch_id,id),',"CHECK(table_id IS NOT NULL OR (table_name='Без стола' AND zone_name='')), UNIQUE(branch_id,id),")
 .replace('OLD.table_id IS NOT NEW.table_id OR','(OLD.table_id IS NOT NULL AND OLD.table_id IS NOT NEW.table_id) OR')
 .replace('OLD.table_name IS NOT NEW.table_name OR OLD.zone_name IS NOT NEW.zone_name OR',"((OLD.table_id IS NOT NULL OR NEW.table_id IS NULL) AND (OLD.table_name IS NOT NEW.table_name OR OLD.zone_name IS NOT NEW.zone_name)) OR");
const terminal=finance.slice(finance.indexOf('CREATE TRIGGER visit_terminal'),finance.indexOf('CREATE TABLE order_corrections'));
export const migration=`
PRAGMA defer_foreign_keys=ON;
CREATE TEMP TABLE saved_cash_visits AS SELECT * FROM table_sessions;
DROP TRIGGER table_config_occupied;
DROP TABLE table_sessions;
${visits}
INSERT INTO table_sessions SELECT * FROM saved_cash_visits;
DROP TABLE saved_cash_visits;
${terminal}
CREATE TRIGGER table_sessions_open_shift BEFORE INSERT ON table_sessions WHEN NOT EXISTS(SELECT 1 FROM shifts WHERE branch_id=NEW.branch_id AND id=NEW.shift_id AND status='OPEN')
 BEGIN SELECT RAISE(ABORT,'SHIFT_NOT_OPEN'); END;
CREATE TRIGGER visit_assignment_valid BEFORE UPDATE OF table_id ON table_sessions WHEN OLD.table_id IS NULL AND NEW.table_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM dining_tables t JOIN dining_zones z ON z.branch_id=t.branch_id AND z.id=t.zone_id
 WHERE t.branch_id=NEW.branch_id AND t.id=NEW.table_id AND t.active=1 AND z.active=1 AND t.name=NEW.table_name AND z.name=NEW.zone_name
) BEGIN SELECT RAISE(ABORT,'INVALID_VISIT_ASSIGNMENT'); END;
CREATE TABLE order_fulfillment_events (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, order_id TEXT NOT NULL, item_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), issued INTEGER NOT NULL CHECK(issued IN (0,1)),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9999), actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
 created_at INTEGER NOT NULL, command_id TEXT NOT NULL,
 UNIQUE(branch_id,item_id,revision), UNIQUE(branch_id,command_id),
 FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
 FOREIGN KEY(branch_id,item_id) REFERENCES order_items(branch_id,id),
 FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TRIGGER fulfillment_item_scope BEFORE INSERT ON order_fulfillment_events WHEN NOT EXISTS(
 SELECT 1 FROM order_items i JOIN order_batches b ON b.branch_id=i.branch_id AND b.id=i.batch_id
 WHERE i.branch_id=NEW.branch_id AND i.id=NEW.item_id AND b.order_id=NEW.order_id
) BEGIN SELECT RAISE(ABORT,'INVALID_FULFILLMENT_SCOPE'); END;
CREATE TRIGGER fulfillment_no_update BEFORE UPDATE ON order_fulfillment_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FULFILLMENT_EVENT'); END;
CREATE TRIGGER fulfillment_no_delete BEFORE DELETE ON order_fulfillment_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FULFILLMENT_EVENT'); END;
`;
