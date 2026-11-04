export const migration = `CREATE TABLE bootstrap_instance (id TEXT PRIMARY KEY NOT NULL, activation_state TEXT NOT NULL CHECK (activation_state = 'UNACTIVATED'));
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL);`;
