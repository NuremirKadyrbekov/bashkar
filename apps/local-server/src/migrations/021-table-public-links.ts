export const migration = `
CREATE TABLE dining_table_public_links (
 branch_id TEXT NOT NULL,
 table_id TEXT NOT NULL,
 code TEXT NOT NULL CHECK(length(code)=22),
 created_at INTEGER NOT NULL,
 rotated_at INTEGER,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(branch_id,table_id),
 UNIQUE(branch_id,code),
 FOREIGN KEY(branch_id,table_id) REFERENCES dining_tables(branch_id,id)
) STRICT;
`;
