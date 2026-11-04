export const migration = `
CREATE TABLE menu_current_saved AS SELECT * FROM menu_current;
DROP TABLE menu_current;
DROP TRIGGER menu_no_update;
DROP TRIGGER menu_no_delete;
CREATE TABLE menu_revisions_new (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES activation(branch_id), base_revision INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 document TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL,
 UNIQUE(branch_id,revision), FOREIGN KEY(branch_id,created_by) REFERENCES employees(branch_id,id)
) STRICT;
INSERT INTO menu_revisions_new SELECT * FROM menu_revisions;
DROP TABLE menu_revisions;
ALTER TABLE menu_revisions_new RENAME TO menu_revisions;
CREATE TABLE menu_current (branch_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, FOREIGN KEY(branch_id,revision) REFERENCES menu_revisions(branch_id,revision)) STRICT;
INSERT INTO menu_current SELECT * FROM menu_current_saved;
DROP TABLE menu_current_saved;
CREATE TRIGGER menu_no_update BEFORE UPDATE ON menu_revisions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MENU'); END;
CREATE TRIGGER menu_no_delete BEFORE DELETE ON menu_revisions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MENU'); END;
CREATE TABLE menu_sync_versions (
 branch_id TEXT NOT NULL, local_revision INTEGER NOT NULL, version_id TEXT NOT NULL UNIQUE,
 parent_id TEXT, content_hash TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('LOCAL_POS','CLOUD_OWNER','CLOUD_RESTORE')),
 author TEXT NOT NULL, published_at INTEGER NOT NULL, cloud_state TEXT NOT NULL DEFAULT 'PENDING' CHECK(cloud_state IN ('PENDING','ACCEPTED','CONFLICT','INBOUND')),
 operation_id TEXT NOT NULL UNIQUE, PRIMARY KEY(branch_id,local_revision), FOREIGN KEY(branch_id,local_revision) REFERENCES menu_revisions(branch_id,revision)
) STRICT;
CREATE TABLE menu_sync_state (
 branch_id TEXT PRIMARY KEY REFERENCES activation(branch_id), common_id TEXT, remote_head TEXT, remote_generation INTEGER NOT NULL DEFAULT 0,
 incoming TEXT, error TEXT, attempted_at INTEGER, connected_at INTEGER, next_attempt INTEGER NOT NULL DEFAULT 0,
 failure_count INTEGER NOT NULL DEFAULT 0, ack_pending TEXT, last_ack TEXT, manual_base TEXT
) STRICT;
CREATE TABLE menu_sync_leases (
 session_id TEXT PRIMARY KEY REFERENCES auth_sessions(id), branch_id TEXT NOT NULL REFERENCES activation(branch_id), expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE menu_draft_sync (
 draft_id TEXT PRIMARY KEY REFERENCES menu_drafts(id), state TEXT NOT NULL CHECK(state IN ('EDITING','PUBLISHED','ABANDONED'))
) STRICT;
INSERT INTO menu_draft_sync SELECT d.id,CASE WHEN EXISTS (SELECT 1 FROM menu_revisions r WHERE r.branch_id=d.branch_id AND r.document=d.document AND r.base_revision=d.base_revision) THEN 'PUBLISHED' ELSE 'EDITING' END FROM menu_drafts d;
CREATE TRIGGER menu_draft_sync_insert AFTER INSERT ON menu_drafts BEGIN INSERT INTO menu_draft_sync VALUES(NEW.id,'EDITING'); END;
CREATE TRIGGER menu_draft_sync_update AFTER UPDATE ON menu_drafts BEGIN UPDATE menu_draft_sync SET state='EDITING' WHERE draft_id=NEW.id; END;
`;
