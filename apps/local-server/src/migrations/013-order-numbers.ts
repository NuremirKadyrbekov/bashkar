// Keep immutable orders and historical print snapshots intact. Legacy COUNTER
// numbers seed the shared sequence; legacy TABLE orders remain unnumbered.
export const migration = `
CREATE TABLE order_sequences (
 branch_id TEXT NOT NULL, shift_id TEXT NOT NULL, next_number INTEGER NOT NULL CHECK(next_number>0),
 PRIMARY KEY(branch_id,shift_id), FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id)
) STRICT;
CREATE TABLE order_numbers (
 branch_id TEXT NOT NULL, order_id TEXT NOT NULL, shift_id TEXT NOT NULL, number INTEGER NOT NULL CHECK(number>0),
 PRIMARY KEY(branch_id,order_id), UNIQUE(branch_id,shift_id,number),
 FOREIGN KEY(branch_id,order_id) REFERENCES orders(branch_id,id), FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id)
) STRICT;
INSERT INTO order_numbers SELECT branch_id,id,shift_id,counter_number FROM orders WHERE type='COUNTER';
INSERT INTO order_sequences SELECT branch_id,shift_id,MAX(counter_number)+1 FROM orders WHERE type='COUNTER' GROUP BY branch_id,shift_id;
CREATE TRIGGER order_number_scope BEFORE INSERT ON order_numbers WHEN NOT EXISTS (
 SELECT 1 FROM orders WHERE branch_id=NEW.branch_id AND id=NEW.order_id AND shift_id=NEW.shift_id
) BEGIN SELECT RAISE(ABORT,'INVALID_ORDER_NUMBER_SCOPE'); END;
CREATE TRIGGER order_number_no_update BEFORE UPDATE ON order_numbers BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_NUMBER'); END;
CREATE TRIGGER order_number_no_delete BEFORE DELETE ON order_numbers BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_NUMBER'); END;
`;
