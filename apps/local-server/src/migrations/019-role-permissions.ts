export const migration = `
CREATE TABLE role_permission_revisions (
 branch_id TEXT NOT NULL REFERENCES activation(branch_id), role TEXT NOT NULL CHECK(role IN ('MANAGER','CASHIER','WAITER')),
 revision INTEGER NOT NULL CHECK(revision>0), PRIMARY KEY(branch_id,role)
) STRICT;
CREATE TABLE role_permission_overrides (
 branch_id TEXT NOT NULL REFERENCES activation(branch_id), role TEXT NOT NULL CHECK(role IN ('MANAGER','CASHIER','WAITER')),
 permission TEXT NOT NULL, allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
 PRIMARY KEY(branch_id,role,permission), FOREIGN KEY(branch_id,role) REFERENCES role_permission_revisions(branch_id,role)
) STRICT;
`;
