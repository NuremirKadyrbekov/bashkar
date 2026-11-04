export const migration = `
CREATE TABLE print_device_revisions (
 id TEXT NOT NULL,branch_id TEXT NOT NULL REFERENCES activation(branch_id),revision INTEGER NOT NULL CHECK(revision>0),
 physical_id TEXT NOT NULL,queue_name TEXT NOT NULL,driver_name TEXT NOT NULL,port_name TEXT NOT NULL,profile TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(branch_id,id,revision),FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE print_role_routes (
 branch_id TEXT NOT NULL REFERENCES activation(branch_id),role TEXT NOT NULL CHECK(role IN ('KITCHEN','CUSTOMER')),
 revision INTEGER NOT NULL CHECK(revision>0),device_id TEXT NOT NULL,device_revision INTEGER NOT NULL,backup_id TEXT,backup_revision INTEGER,
 actor_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(branch_id,role,revision),
 FOREIGN KEY(branch_id,device_id,device_revision) REFERENCES print_device_revisions(branch_id,id,revision),
 FOREIGN KEY(branch_id,backup_id,backup_revision) REFERENCES print_device_revisions(branch_id,id,revision),
 FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id),CHECK((backup_id IS NULL)=(backup_revision IS NULL))
) STRICT;
CREATE TABLE print_dispatches (
 id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,job_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation>=0),parent_id TEXT,
 role TEXT NOT NULL CHECK(role IN ('KITCHEN','CUSTOMER')),route_revision INTEGER,device_id TEXT,device_revision INTEGER,
 state TEXT NOT NULL CHECK(state IN ('UNCONFIGURED','PENDING','CLAIMED','IN_PROGRESS','SENT','FAILED_SAFE','UNKNOWN','MANUAL_HANDOFF','RESOLVED_NO_PRINT','LEGACY_REVIEW','LATE_REVIEW')),
 revision INTEGER NOT NULL CHECK(revision>0),attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),active_attempt TEXT,next_attempt_at INTEGER NOT NULL DEFAULT 0,
 late_approved INTEGER NOT NULL DEFAULT 0 CHECK(late_approved IN(0,1)),is_repeat INTEGER NOT NULL DEFAULT 0 CHECK(is_repeat IN(0,1)),created_at INTEGER NOT NULL,
 UNIQUE(branch_id,id),UNIQUE(branch_id,job_id,generation),FOREIGN KEY(branch_id,active_attempt) REFERENCES print_attempts(branch_id,id) DEFERRABLE INITIALLY DEFERRED,FOREIGN KEY(branch_id,job_id) REFERENCES print_jobs(branch_id,id),
 FOREIGN KEY(branch_id,parent_id) REFERENCES print_dispatches(branch_id,id),
 FOREIGN KEY(branch_id,device_id,device_revision) REFERENCES print_device_revisions(branch_id,id,revision),
 FOREIGN KEY(branch_id,role,route_revision) REFERENCES print_role_routes(branch_id,role,revision),CHECK((device_id IS NULL)=(device_revision IS NULL))
) STRICT;
CREATE UNIQUE INDEX print_one_active_delivery ON print_dispatches(branch_id,job_id) WHERE state IN ('PENDING','CLAIMED','IN_PROGRESS','FAILED_SAFE');
CREATE INDEX print_schedule ON print_dispatches(branch_id,state,next_attempt_at);
CREATE TABLE print_diagnostics (
 id TEXT PRIMARY KEY,branch_id TEXT NOT NULL REFERENCES activation(branch_id),device_id TEXT NOT NULL,device_revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('PENDING','CLAIMED','IN_PROGRESS','SENT','FAILED_SAFE','UNKNOWN','RESOLVED_NO_PRINT')),revision INTEGER NOT NULL CHECK(revision>0),attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),active_attempt TEXT,next_attempt_at INTEGER NOT NULL DEFAULT 0,
 payload TEXT NOT NULL,actor_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(branch_id,id),
 FOREIGN KEY(branch_id,active_attempt) REFERENCES print_attempts(branch_id,id) DEFERRABLE INITIALLY DEFERRED,FOREIGN KEY(branch_id,device_id,device_revision) REFERENCES print_device_revisions(branch_id,id,revision),FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE print_attempts (
 id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,dispatch_id TEXT,diagnostic_id TEXT,worker_epoch TEXT NOT NULL,created_at INTEGER NOT NULL,
 payload_hash TEXT NOT NULL,render_version INTEGER NOT NULL CHECK(render_version=1),UNIQUE(branch_id,id),
 FOREIGN KEY(branch_id,dispatch_id) REFERENCES print_dispatches(branch_id,id),FOREIGN KEY(branch_id,diagnostic_id) REFERENCES print_diagnostics(branch_id,id),CHECK((dispatch_id IS NULL)<>(diagnostic_id IS NULL))
) STRICT;
CREATE TABLE print_delivery_events (
 id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,dispatch_id TEXT,diagnostic_id TEXT,revision INTEGER NOT NULL,attempt_id TEXT,
 state TEXT NOT NULL,details TEXT NOT NULL,actor_id TEXT,created_at INTEGER NOT NULL,command_id TEXT,
 UNIQUE(branch_id,dispatch_id,revision),UNIQUE(branch_id,diagnostic_id,revision),FOREIGN KEY(branch_id,dispatch_id) REFERENCES print_dispatches(branch_id,id),
 FOREIGN KEY(branch_id,diagnostic_id) REFERENCES print_diagnostics(branch_id,id),CHECK((dispatch_id IS NULL)<>(diagnostic_id IS NULL)),FOREIGN KEY(branch_id,attempt_id) REFERENCES print_attempts(branch_id,id),FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id)
) STRICT;
CREATE TABLE print_device_leases (
 branch_id TEXT NOT NULL,physical_id TEXT NOT NULL,attempt_id TEXT NOT NULL,worker_epoch TEXT NOT NULL,
 PRIMARY KEY(branch_id,physical_id),UNIQUE(branch_id,attempt_id),FOREIGN KEY(branch_id,attempt_id) REFERENCES print_attempts(branch_id,id)
) STRICT;
CREATE TABLE print_operator_actions (
 command_id TEXT PRIMARY KEY,branch_id TEXT NOT NULL,dispatch_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,
 actor_id TEXT NOT NULL,created_at INTEGER NOT NULL,successor_id TEXT,
 FOREIGN KEY(branch_id,dispatch_id) REFERENCES print_dispatches(branch_id,id),FOREIGN KEY(branch_id,actor_id) REFERENCES employees(branch_id,id),
 FOREIGN KEY(branch_id,successor_id) REFERENCES print_dispatches(branch_id,id)
) STRICT;
CREATE TRIGGER print_dispatch_identity BEFORE UPDATE ON print_dispatches WHEN OLD.id IS NOT NEW.id OR OLD.branch_id IS NOT NEW.branch_id OR OLD.job_id IS NOT NEW.job_id OR OLD.generation IS NOT NEW.generation OR OLD.parent_id IS NOT NEW.parent_id OR OLD.role IS NOT NEW.role OR OLD.route_revision IS NOT NEW.route_revision OR OLD.device_id IS NOT NEW.device_id OR OLD.device_revision IS NOT NEW.device_revision OR OLD.is_repeat IS NOT NEW.is_repeat OR OLD.created_at IS NOT NEW.created_at OR NEW.revision<>OLD.revision+1
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRINT_DISPATCH_IDENTITY'); END;
CREATE TRIGGER print_diagnostic_identity BEFORE UPDATE ON print_diagnostics WHEN OLD.id IS NOT NEW.id OR OLD.branch_id IS NOT NEW.branch_id OR OLD.device_id IS NOT NEW.device_id OR OLD.device_revision IS NOT NEW.device_revision OR OLD.payload IS NOT NEW.payload OR OLD.actor_id IS NOT NEW.actor_id OR OLD.created_at IS NOT NEW.created_at OR NEW.revision<>OLD.revision+1 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRINT_DIAGNOSTIC_IDENTITY');END;
CREATE TRIGGER print_diagnostic_no_delete BEFORE DELETE ON print_diagnostics BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRINT_HISTORY'); END;
CREATE TRIGGER print_dispatch_no_delete BEFORE DELETE ON print_dispatches BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRINT_HISTORY'); END;
${['print_device_revisions','print_role_routes','print_attempts','print_delivery_events','print_operator_actions'].map(t=>`
CREATE TRIGGER ${t}_immutable_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRINT_HISTORY'); END;
CREATE TRIGGER ${t}_immutable_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRINT_HISTORY'); END;`).join('')}
INSERT INTO print_dispatches(id,branch_id,job_id,generation,role,state,revision,created_at)
 SELECT id,branch_id,id,0,type,'LEGACY_REVIEW',1,created_at FROM print_jobs;
INSERT INTO print_delivery_events(id,branch_id,dispatch_id,revision,state,details,created_at)
 SELECT id,branch_id,id,1,'LEGACY_REVIEW','{"reason":"PRE_C_BACKLOG"}',created_at FROM print_jobs;
CREATE TRIGGER print_create_dispatch AFTER INSERT ON print_jobs BEGIN
 INSERT INTO print_dispatches(id,branch_id,job_id,generation,role,route_revision,device_id,device_revision,state,revision,created_at)
 SELECT NEW.id,NEW.branch_id,NEW.id,0,NEW.type,
 (SELECT MAX(revision) FROM print_role_routes WHERE branch_id=NEW.branch_id AND role=NEW.type),
 (SELECT device_id FROM print_role_routes WHERE branch_id=NEW.branch_id AND role=NEW.type ORDER BY revision DESC LIMIT 1),
 (SELECT device_revision FROM print_role_routes WHERE branch_id=NEW.branch_id AND role=NEW.type ORDER BY revision DESC LIMIT 1),
 CASE WHEN EXISTS(SELECT 1 FROM print_role_routes WHERE branch_id=NEW.branch_id AND role=NEW.type) THEN 'PENDING' ELSE 'UNCONFIGURED' END,1,NEW.created_at;
 INSERT INTO print_delivery_events(id,branch_id,dispatch_id,revision,state,details,created_at)
 SELECT NEW.id,NEW.branch_id,NEW.id,1,state,'{}',NEW.created_at FROM print_dispatches WHERE id=NEW.id;
END;
`;
