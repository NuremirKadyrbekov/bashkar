import {migration as tables} from './004-tables';
import {migration as orders} from './005-orders-batches';

// Rebuild the complete dependent graph with foreign_keys ON. Preserve original
// bytes, IDs and column order; no rename of a referenced historical parent.
const graph=['table_sessions','orders','order_batches','order_items','order_discount_events','print_jobs'];
const visits=tables.slice(tables.indexOf('CREATE TABLE table_sessions'),tables.indexOf('CREATE TRIGGER table_no_delete'))
 .replace("close_reason='EMPTY')","close_reason IN ('EMPTY','PAID','ZERO_TOTAL','CANCELLED'))")
 .replace("close_reason='EMPTY' AND has_accepted_batch=0 AND has_registered_payment=0", "((close_reason='EMPTY' AND has_accepted_batch=0 AND has_registered_payment=0) OR (close_reason IN ('PAID','ZERO_TOTAL','CANCELLED') AND has_accepted_batch=1 AND (close_reason='PAID' OR has_registered_payment=0)))");
const orderGraph=orders
 .replace('table_session_id TEXT NOT NULL','table_session_id TEXT')
 .replace("CHECK(type='TABLE')","CHECK(type IN ('TABLE','COUNTER'))")
 .replace("CHECK(status='OPEN')","CHECK(status IN ('OPEN','COMPLETED','CANCELLED'))")
 .replace('created_at INTEGER NOT NULL, UNIQUE(branch_id,id), UNIQUE(branch_id,table_session_id)',`created_at INTEGER NOT NULL,
 financial_state TEXT NOT NULL DEFAULT 'UNPAID' CHECK(financial_state IN ('UNPAID','PAID','ZERO_SETTLED','CANCELLED')),
 counter_number INTEGER, guest_label TEXT, terminal_at INTEGER, terminal_by TEXT,
 CHECK((type='TABLE' AND table_session_id IS NOT NULL AND counter_number IS NULL) OR (type='COUNTER' AND table_session_id IS NULL AND counter_number>0 AND fees_snapshot='{"fees":[],"revision":0}')),
 CHECK((status='OPEN' AND financial_state='UNPAID' AND terminal_at IS NULL AND terminal_by IS NULL) OR
 (status='COMPLETED' AND financial_state IN ('PAID','ZERO_SETTLED') AND terminal_at IS NOT NULL AND terminal_by IS NOT NULL) OR
 (status='CANCELLED' AND financial_state='CANCELLED' AND terminal_at IS NOT NULL AND terminal_by IS NOT NULL)),
 CHECK(guest_label IS NULL OR length(guest_label)<=100),
 UNIQUE(branch_id,shift_id,counter_number), UNIQUE(branch_id,id), UNIQUE(branch_id,table_session_id)`)
 .replace("batch_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type='KITCHEN')", "batch_id TEXT, type TEXT NOT NULL CHECK(type IN ('KITCHEN','CUSTOMER'))")
 .replace("CHECK(purpose='NEW_BATCH')", "CHECK(purpose IN ('NEW_BATCH','CANCEL','CHANGE_COMMENT','SETTLEMENT'))")
 .replace('CHECK(snapshot_version=1)','CHECK(snapshot_version IN (1,2))')
 .replace('payload TEXT NOT NULL, created_at INTEGER NOT NULL,','payload TEXT NOT NULL, created_at INTEGER NOT NULL, correction_id TEXT, settlement_id TEXT, job_sequence INTEGER NOT NULL DEFAULT 1 CHECK(job_sequence>0),')
 .replace('UNIQUE(batch_id,purpose)', 'UNIQUE(batch_id,purpose,correction_id)')
 .replace('OLD.shift_id IS NOT NEW.shift_id OR', 'OLD.status<>\'OPEN\' OR OLD.counter_number IS NOT NEW.counter_number OR OLD.guest_label IS NOT NEW.guest_label OR OLD.shift_id IS NOT NEW.shift_id OR');
const immutable=(name:string)=>`CREATE TRIGGER ${name}_no_update BEFORE UPDATE ON ${name} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_FACT'); END;
CREATE TRIGGER ${name}_no_delete BEFORE DELETE ON ${name} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_FACT'); END;`;
export const migration=`
${graph.map(t=>`CREATE TEMP TABLE saved_${t} AS SELECT * FROM ${t};`).join('\n')}
DROP TRIGGER table_config_occupied;
${[...graph].reverse().map(t=>`DROP TABLE ${t};`).join('\n')}
${visits}
${orderGraph}
INSERT INTO table_sessions SELECT * FROM saved_table_sessions;
INSERT INTO orders(id,branch_id,shift_id,table_session_id,type,status,revision,discount,subtotal,total,fees_snapshot,created_at) SELECT * FROM saved_orders;
INSERT INTO order_batches SELECT * FROM saved_order_batches;
INSERT INTO order_items SELECT * FROM saved_order_items;
INSERT INTO order_discount_events SELECT * FROM saved_order_discount_events;
INSERT INTO print_jobs(id,branch_id,order_id,batch_id,type,purpose,snapshot_version,status,payload,created_at) SELECT * FROM saved_print_jobs;
${graph.map(t=>`DROP TABLE saved_${t};`).join('\n')}
CREATE UNIQUE INDEX kitchen_batch_once ON print_jobs(batch_id) WHERE purpose='NEW_BATCH';
CREATE TABLE order_item_portions (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, item_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 0 AND 9999),
 comment TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), UNIQUE(branch_id,id),
 FOREIGN KEY(branch_id,item_id) REFERENCES order_items(branch_id,id)
) STRICT;
INSERT INTO order_item_portions SELECT id,branch_id,id,quantity,json_extract(snapshot,'$.comment'),1 FROM order_items;
CREATE TRIGGER item_initial_portion AFTER INSERT ON order_items BEGIN
 INSERT INTO order_item_portions VALUES(NEW.id,NEW.branch_id,NEW.id,NEW.quantity,json_extract(NEW.snapshot,'$.comment'),1); END;
CREATE TRIGGER portion_insert BEFORE INSERT ON order_item_portions WHEN NEW.quantity + COALESCE((SELECT SUM(quantity) FROM order_item_portions WHERE branch_id=NEW.branch_id AND item_id=NEW.item_id),0) > (SELECT quantity FROM order_items WHERE branch_id=NEW.branch_id AND id=NEW.item_id)
 BEGIN SELECT RAISE(ABORT,'PORTION_QUANTITY_EXCEEDED'); END;
CREATE TRIGGER portion_update BEFORE UPDATE ON order_item_portions WHEN OLD.id IS NOT NEW.id OR OLD.branch_id IS NOT NEW.branch_id OR OLD.item_id IS NOT NEW.item_id OR NEW.revision<>OLD.revision+1 OR NEW.quantity>OLD.quantity OR
 NEW.quantity+COALESCE((SELECT SUM(quantity) FROM order_item_portions WHERE branch_id=NEW.branch_id AND item_id=NEW.item_id AND id<>OLD.id),0)>(SELECT quantity FROM order_items WHERE branch_id=NEW.branch_id AND id=NEW.item_id)
 BEGIN SELECT RAISE(ABORT,'PORTION_QUANTITY_EXCEEDED'); END;
CREATE TRIGGER portion_no_delete BEFORE DELETE ON order_item_portions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PORTION'); END;
CREATE TABLE settlements (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, order_id TEXT NOT NULL, shift_id TEXT NOT NULL, command_id TEXT NOT NULL,
 order_revision INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('PAID','ZERO_SETTLED')), amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 999999999),
 snapshot TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, settled_at INTEGER NOT NULL,
 UNIQUE(branch_id,id), UNIQUE(branch_id,id,order_id,shift_id), UNIQUE(branch_id,command_id),
 FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id), FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id),
 FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id), CHECK((kind='PAID' AND amount>0) OR (kind='ZERO_SETTLED' AND amount=0))
) STRICT;
CREATE TABLE payments (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, settlement_id TEXT NOT NULL, order_id TEXT NOT NULL, shift_id TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('CASH','CARD_MANUAL','QR_TRANSFER_MANUAL')), amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 999999999),
 actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, registered_at INTEGER NOT NULL, UNIQUE(branch_id,id), UNIQUE(settlement_id,method),
 FOREIGN KEY(branch_id,settlement_id,order_id,shift_id) REFERENCES settlements(branch_id,id,order_id,shift_id),
 FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE settlement_seals (
 order_id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, settlement_id TEXT NOT NULL UNIQUE,
 FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
 FOREIGN KEY(branch_id,settlement_id) REFERENCES settlements(branch_id,id)
) STRICT;
CREATE TRIGGER settlement_matches BEFORE INSERT ON settlements WHEN NOT EXISTS(SELECT 1 FROM orders o JOIN shifts s ON s.id=o.shift_id AND s.branch_id=o.branch_id
 WHERE o.id=NEW.order_id AND o.branch_id=NEW.branch_id AND o.shift_id=NEW.shift_id AND o.revision=NEW.order_revision AND o.status='OPEN' AND o.total=NEW.amount AND s.status='OPEN')
 BEGIN SELECT RAISE(ABORT,'INVALID_SETTLEMENT_ORDER'); END;
CREATE TRIGGER payment_unsealed BEFORE INSERT ON payments WHEN EXISTS(SELECT 1 FROM settlement_seals WHERE settlement_id=NEW.settlement_id)
 BEGIN SELECT RAISE(ABORT,'SETTLEMENT_SEALED'); END;
CREATE TRIGGER validate_seal BEFORE INSERT ON settlement_seals WHEN NOT EXISTS(
 SELECT 1 FROM settlements s WHERE s.id=NEW.settlement_id AND s.branch_id=NEW.branch_id AND s.order_id=NEW.order_id
 AND ((s.kind='PAID' AND (SELECT COUNT(*) FROM payments WHERE settlement_id=s.id) BETWEEN 1 AND 2 AND (SELECT SUM(amount) FROM payments WHERE settlement_id=s.id)=s.amount)
 OR (s.kind='ZERO_SETTLED' AND NOT EXISTS(SELECT 1 FROM payments WHERE settlement_id=s.id)))
 AND EXISTS(SELECT 1 FROM order_item_portions p JOIN order_items i ON i.id=p.item_id AND i.branch_id=p.branch_id JOIN order_batches b ON b.id=i.batch_id AND b.branch_id=i.branch_id WHERE b.order_id=s.order_id AND b.branch_id=s.branch_id AND p.quantity>0))
 BEGIN SELECT RAISE(ABORT,'INVALID_SETTLEMENT_PAYMENTS'); END;
CREATE TRIGGER order_terminal BEFORE UPDATE ON orders WHEN
 (NEW.status='COMPLETED' AND NOT EXISTS(SELECT 1 FROM settlement_seals z JOIN settlements s ON s.id=z.settlement_id WHERE z.order_id=NEW.id AND z.branch_id=NEW.branch_id AND s.kind=NEW.financial_state AND s.amount=NEW.total)) OR
 (NEW.status='CANCELLED' AND EXISTS(SELECT 1 FROM order_batches b JOIN order_items i ON i.batch_id=b.id JOIN order_item_portions p ON p.item_id=i.id WHERE b.order_id=NEW.id AND p.quantity>0))
 BEGIN SELECT RAISE(ABORT,'INVALID_ORDER_FINALIZATION'); END;
CREATE TRIGGER visit_terminal BEFORE UPDATE ON table_sessions WHEN NEW.status='CLOSED' AND NEW.close_reason<>'EMPTY' AND NOT EXISTS(
 SELECT 1 FROM orders o WHERE o.branch_id=NEW.branch_id AND o.table_session_id=NEW.id AND
 ((NEW.close_reason='PAID' AND o.financial_state='PAID') OR (NEW.close_reason='ZERO_TOTAL' AND o.financial_state='ZERO_SETTLED') OR (NEW.close_reason='CANCELLED' AND o.status='CANCELLED')))
 BEGIN SELECT RAISE(ABORT,'INVALID_VISIT_FINALIZATION'); END;
CREATE TABLE order_corrections (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, order_id TEXT NOT NULL, shift_id TEXT NOT NULL, command_id TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('CANCEL_QUANTITY','GROUP_CANCEL','REPLACE_ITEM','CHANGE_COMMENT','CANCEL_ORDER')),
 reason TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, created_at INTEGER NOT NULL, snapshot TEXT NOT NULL, replacement_batch_id TEXT,
 UNIQUE(branch_id,id), UNIQUE(branch_id,command_id), FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
 FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id), FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id),
 FOREIGN KEY(branch_id,replacement_batch_id) REFERENCES order_batches(branch_id,id)
) STRICT;
CREATE TABLE order_correction_lines (
 correction_id TEXT NOT NULL, branch_id TEXT NOT NULL, item_id TEXT NOT NULL, portion_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9999),
 old_comment TEXT NOT NULL, new_comment TEXT, new_portion_id TEXT, PRIMARY KEY(correction_id,portion_id),
 FOREIGN KEY(branch_id,correction_id) REFERENCES order_corrections(branch_id,id), FOREIGN KEY(branch_id,item_id) REFERENCES order_items(branch_id,id),
 FOREIGN KEY(branch_id,portion_id) REFERENCES order_item_portions(branch_id,id), FOREIGN KEY(branch_id,new_portion_id) REFERENCES order_item_portions(branch_id,id)
) STRICT;
CREATE TABLE counter_sequences (branch_id TEXT NOT NULL,shift_id TEXT NOT NULL,next_number INTEGER NOT NULL CHECK(next_number>0),PRIMARY KEY(branch_id,shift_id),FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id)) STRICT;
CREATE TABLE counter_worklist (order_id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,visibility TEXT NOT NULL CHECK(visibility IN ('VISIBLE','HIDDEN')),revision INTEGER NOT NULL CHECK(revision>0),FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id)) STRICT;
CREATE TABLE counter_visibility_events (id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,order_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,created_at INTEGER NOT NULL,FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)) STRICT;
CREATE TABLE print_job_dependencies (branch_id TEXT NOT NULL,predecessor_id TEXT NOT NULL,successor_id TEXT NOT NULL,PRIMARY KEY(predecessor_id,successor_id),CHECK(predecessor_id<>successor_id),FOREIGN KEY(branch_id,predecessor_id) REFERENCES print_jobs(branch_id,id),FOREIGN KEY(branch_id,successor_id) REFERENCES print_jobs(branch_id,id)) STRICT;
CREATE TRIGGER print_dependency_order BEFORE INSERT ON print_job_dependencies WHEN NOT EXISTS(SELECT 1 FROM print_jobs a JOIN print_jobs b ON b.branch_id=a.branch_id AND b.order_id=a.order_id WHERE a.id=NEW.predecessor_id AND b.id=NEW.successor_id AND a.branch_id=NEW.branch_id AND a.rowid<b.rowid)
 BEGIN SELECT RAISE(ABORT,'INVALID_JOB_DEPENDENCY'); END;
CREATE UNIQUE INDEX customer_settlement_once ON print_jobs(settlement_id) WHERE type='CUSTOMER';
CREATE INDEX sales_time ON settlements(branch_id,settled_at,id);
CREATE TABLE payment_incidents (
 id TEXT PRIMARY KEY,branch_id TEXT NOT NULL REFERENCES activation(branch_id),shift_id TEXT NOT NULL,order_id TEXT,draft_id TEXT,source_command_id TEXT,
 actor_id TEXT NOT NULL,created_at INTEGER NOT NULL,state TEXT NOT NULL CHECK(state='OPEN'),details TEXT NOT NULL,UNIQUE(branch_id,id),
 CHECK((order_id IS NOT NULL)<>(draft_id IS NOT NULL)),FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id),FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TRIGGER print_reference_scope BEFORE INSERT ON print_jobs WHEN NOT (
 (NEW.type='KITCHEN' AND NEW.purpose='NEW_BATCH' AND NEW.correction_id IS NULL AND NEW.settlement_id IS NULL AND EXISTS(SELECT 1 FROM order_batches b WHERE b.id=NEW.batch_id AND b.branch_id=NEW.branch_id AND b.order_id=NEW.order_id)) OR
 (NEW.type='KITCHEN' AND NEW.purpose IN ('CANCEL','CHANGE_COMMENT') AND NEW.batch_id IS NULL AND NEW.settlement_id IS NULL AND EXISTS(SELECT 1 FROM order_corrections c WHERE c.id=NEW.correction_id AND c.branch_id=NEW.branch_id AND c.order_id=NEW.order_id)) OR
 (NEW.type='CUSTOMER' AND NEW.purpose='SETTLEMENT' AND NEW.batch_id IS NULL AND NEW.correction_id IS NULL AND EXISTS(SELECT 1 FROM settlement_seals z JOIN settlements s ON s.id=z.settlement_id WHERE z.settlement_id=NEW.settlement_id AND z.branch_id=NEW.branch_id AND z.order_id=NEW.order_id))
 ) BEGIN SELECT RAISE(ABORT,'INVALID_PRINT_REFERENCE'); END;
CREATE TRIGGER portion_terminal_update BEFORE UPDATE ON order_item_portions WHEN EXISTS(
 SELECT 1 FROM order_items i JOIN order_batches b ON b.id=i.batch_id JOIN orders o ON o.id=b.order_id WHERE i.id=OLD.item_id AND o.status<>'OPEN')
 BEGIN SELECT RAISE(ABORT,'ORDER_NOT_OPEN'); END;
CREATE TRIGGER portion_terminal_insert BEFORE INSERT ON order_item_portions WHEN EXISTS(
 SELECT 1 FROM order_items i JOIN order_batches b ON b.id=i.batch_id JOIN orders o ON o.id=b.order_id WHERE i.id=NEW.item_id AND o.status<>'OPEN')
 BEGIN SELECT RAISE(ABORT,'ORDER_NOT_OPEN'); END;
CREATE TRIGGER correction_line_scope BEFORE INSERT ON order_correction_lines WHEN NOT EXISTS(
 SELECT 1 FROM order_corrections c JOIN order_batches b ON b.order_id=c.order_id AND b.branch_id=c.branch_id JOIN order_items i ON i.batch_id=b.id AND i.branch_id=b.branch_id JOIN order_item_portions p ON p.item_id=i.id AND p.branch_id=i.branch_id
 WHERE c.id=NEW.correction_id AND c.branch_id=NEW.branch_id AND i.id=NEW.item_id AND p.id=NEW.portion_id AND (NEW.new_portion_id IS NULL OR EXISTS(SELECT 1 FROM order_item_portions n WHERE n.id=NEW.new_portion_id AND n.branch_id=NEW.branch_id AND n.item_id=NEW.item_id)))
 BEGIN SELECT RAISE(ABORT,'INVALID_CORRECTION_REFERENCE'); END;
CREATE TRIGGER worklist_insert BEFORE INSERT ON counter_worklist WHEN NEW.visibility<>'VISIBLE' OR NEW.revision<>1 OR NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND branch_id=NEW.branch_id AND type='COUNTER' AND status='COMPLETED')
 BEGIN SELECT RAISE(ABORT,'COUNTER_NOT_COMPLETED'); END;
CREATE TRIGGER worklist_update BEFORE UPDATE ON counter_worklist WHEN OLD.order_id IS NOT NEW.order_id OR OLD.branch_id IS NOT NEW.branch_id OR OLD.visibility<>'VISIBLE' OR NEW.visibility<>'HIDDEN' OR NEW.revision<>OLD.revision+1
 BEGIN SELECT RAISE(ABORT,'INVALID_VISIBILITY_TRANSITION'); END;
CREATE TRIGGER worklist_no_delete BEFORE DELETE ON counter_worklist BEGIN SELECT RAISE(ABORT,'IMMUTABLE_VISIBILITY'); END;
${['settlements','payments','settlement_seals','order_corrections','order_correction_lines','counter_visibility_events','print_job_dependencies','payment_incidents'].map(immutable).join('\n')}
`;
