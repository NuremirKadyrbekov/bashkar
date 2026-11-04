export const migration = `
CREATE TABLE owner_cloud_auth (
 employee_id TEXT PRIMARY KEY REFERENCES employees(id), owner_cloud_id TEXT NOT NULL UNIQUE,
 email TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE owner_cloud_sessions (
 session_id TEXT PRIMARY KEY REFERENCES auth_sessions(id), employee_id TEXT NOT NULL REFERENCES employees(id),
 owner_cloud_id TEXT NOT NULL, issued_at INTEGER NOT NULL
) STRICT;
`;
