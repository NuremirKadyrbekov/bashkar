export const migration=`
CREATE TABLE shift_cloud_delivery (
 branch_id TEXT NOT NULL,report_id TEXT NOT NULL,shift_id TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),next_attempt_at INTEGER NOT NULL DEFAULT 0,
 delivered_at INTEGER,last_error TEXT,
 PRIMARY KEY(branch_id,report_id),
 FOREIGN KEY(branch_id,report_id,shift_id) REFERENCES shift_reports(branch_id,id,shift_id)
) STRICT;
CREATE INDEX shift_cloud_delivery_pending ON shift_cloud_delivery(branch_id,delivered_at,next_attempt_at);
INSERT INTO shift_cloud_delivery(branch_id,report_id,shift_id)
 SELECT branch_id,id,shift_id FROM shift_reports;
CREATE TABLE sale_cloud_delivery (
 branch_id TEXT NOT NULL,settlement_id TEXT NOT NULL,order_id TEXT NOT NULL,shift_id TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),next_attempt_at INTEGER NOT NULL DEFAULT 0,
 delivered_at INTEGER,last_error TEXT,
 PRIMARY KEY(branch_id,settlement_id),
 FOREIGN KEY(branch_id,settlement_id) REFERENCES settlements(branch_id,id),
 FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id)
) STRICT;
CREATE INDEX sale_cloud_delivery_pending ON sale_cloud_delivery(branch_id,delivered_at,next_attempt_at);
INSERT INTO sale_cloud_delivery(branch_id,settlement_id,order_id,shift_id)
 SELECT s.branch_id,s.id,s.order_id,s.shift_id FROM settlements s
 JOIN shift_closures c ON c.branch_id=s.branch_id AND c.shift_id=s.shift_id
 JOIN settlement_seals z ON z.branch_id=s.branch_id AND z.settlement_id=s.id;
CREATE TRIGGER queue_closed_shift_sales AFTER INSERT ON shift_closures BEGIN
 INSERT OR IGNORE INTO sale_cloud_delivery(branch_id,settlement_id,order_id,shift_id)
 SELECT s.branch_id,s.id,s.order_id,s.shift_id FROM settlements s
 JOIN settlement_seals z ON z.branch_id=s.branch_id AND z.settlement_id=s.id
 WHERE s.branch_id=NEW.branch_id AND s.shift_id=NEW.shift_id;
END;
CREATE TABLE refund_cloud_delivery (
 branch_id TEXT NOT NULL,refund_id TEXT NOT NULL,order_id TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),next_attempt_at INTEGER NOT NULL DEFAULT 0,
 delivered_at INTEGER,last_error TEXT,
 PRIMARY KEY(branch_id,refund_id),
 FOREIGN KEY(branch_id,refund_id) REFERENCES refunds(branch_id,id)
) STRICT;
CREATE INDEX refund_cloud_delivery_pending ON refund_cloud_delivery(branch_id,delivered_at,next_attempt_at);
INSERT INTO refund_cloud_delivery(branch_id,refund_id,order_id)
 SELECT branch_id,id,order_id FROM refunds;
CREATE TRIGGER queue_refund_cloud AFTER INSERT ON refunds BEGIN
 INSERT INTO refund_cloud_delivery(branch_id,refund_id,order_id) VALUES(NEW.branch_id,NEW.id,NEW.order_id);
END;
CREATE TABLE staff_cloud_delivery (
 branch_id TEXT NOT NULL,shift_id TEXT NOT NULL,employee_id TEXT NOT NULL,
 employee_name TEXT NOT NULL,employee_role TEXT NOT NULL,command_id TEXT,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),next_attempt_at INTEGER NOT NULL DEFAULT 0,
 delivered_at INTEGER,last_error TEXT,
 PRIMARY KEY(branch_id,shift_id,employee_id),UNIQUE(branch_id,command_id),
 FOREIGN KEY(branch_id,shift_id) REFERENCES shifts(branch_id,id),
 FOREIGN KEY(branch_id,employee_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE INDEX staff_cloud_delivery_pending ON staff_cloud_delivery(branch_id,delivered_at,next_attempt_at);
INSERT INTO staff_cloud_delivery(branch_id,shift_id,employee_id,employee_name,employee_role)
 SELECT c.branch_id,c.shift_id,e.id,e.name,e.role FROM shift_closures c JOIN employees e ON e.branch_id=c.branch_id;
CREATE TRIGGER queue_closed_shift_staff AFTER INSERT ON shift_closures BEGIN
 INSERT INTO staff_cloud_delivery(branch_id,shift_id,employee_id,employee_name,employee_role)
 SELECT NEW.branch_id,NEW.shift_id,e.id,e.name,e.role FROM employees e WHERE e.branch_id=NEW.branch_id;
END;
`;
