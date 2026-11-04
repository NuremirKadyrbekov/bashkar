export const migration = `
CREATE TABLE orders (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, shift_id TEXT NOT NULL, table_session_id TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type='TABLE'), status TEXT NOT NULL CHECK(status='OPEN'), revision INTEGER NOT NULL CHECK(revision>0),
 discount INTEGER NOT NULL CHECK(discount>=0), subtotal INTEGER NOT NULL CHECK(subtotal>=discount AND subtotal<=999999999),
 total INTEGER NOT NULL CHECK(total>=0 AND total<=999999999), fees_snapshot TEXT NOT NULL,
 created_at INTEGER NOT NULL, UNIQUE(branch_id,id), UNIQUE(branch_id,table_session_id),
 FOREIGN KEY(branch_id,table_session_id) REFERENCES table_sessions(branch_id,id), FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id)
) STRICT;
CREATE TABLE order_batches (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, order_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0), command_id TEXT NOT NULL,
 draft_id TEXT NOT NULL, draft_revision INTEGER NOT NULL CHECK(draft_revision>0), sender_id TEXT NOT NULL, sender_name TEXT NOT NULL,
 submitted_at INTEGER NOT NULL, menu_revision INTEGER NOT NULL, subtotal INTEGER NOT NULL CHECK(subtotal>=0 AND subtotal<=999999999),
 UNIQUE(branch_id,id), UNIQUE(order_id,sequence), UNIQUE(branch_id,command_id), UNIQUE(branch_id,draft_id),
 FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id), FOREIGN KEY(branch_id,sender_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE order_items (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, batch_id TEXT NOT NULL, line_id TEXT NOT NULL, snapshot TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9999), total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 999999999),
 kitchen INTEGER NOT NULL CHECK(kitchen IN(0,1)), UNIQUE(branch_id,id), UNIQUE(batch_id,line_id),
 FOREIGN KEY(branch_id,batch_id) REFERENCES order_batches(branch_id,id)
) STRICT;
CREATE TABLE order_discount_events (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, order_id TEXT NOT NULL, command_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 before_amount INTEGER NOT NULL CHECK(before_amount>=0), after_amount INTEGER NOT NULL CHECK(after_amount>=0), created_at INTEGER NOT NULL,
 FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id), FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE print_jobs (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, order_id TEXT NOT NULL, batch_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type='KITCHEN'),
 purpose TEXT NOT NULL CHECK(purpose='NEW_BATCH'), snapshot_version INTEGER NOT NULL CHECK(snapshot_version=1),
 status TEXT NOT NULL CHECK(status='PENDING'), payload TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(branch_id,id), UNIQUE(batch_id,purpose), FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id),
 FOREIGN KEY(branch_id,batch_id) REFERENCES order_batches(branch_id,id)
) STRICT;
CREATE INDEX order_items_batch ON order_items(branch_id,batch_id);
CREATE INDEX order_batches_history ON order_batches(branch_id,order_id,sequence);
CREATE INDEX print_jobs_order ON print_jobs(branch_id,order_id);
CREATE TRIGGER orders_identity BEFORE UPDATE ON orders WHEN OLD.id IS NOT NEW.id OR OLD.branch_id IS NOT NEW.branch_id OR
 OLD.shift_id IS NOT NEW.shift_id OR OLD.table_session_id IS NOT NEW.table_session_id OR OLD.type IS NOT NEW.type OR
 OLD.fees_snapshot IS NOT NEW.fees_snapshot OR OLD.created_at IS NOT NEW.created_at OR NEW.revision<>OLD.revision+1
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_IDENTITY'); END;
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_HISTORY'); END;
${['order_batches','order_items','order_discount_events','print_jobs'].map(table=>`
CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ACCEPTED_FACT'); END;
CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ACCEPTED_FACT'); END;`).join('')}
`;
