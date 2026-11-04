// Public registration request only; never cloud tokens or any password/key.
export const migration = `
CREATE TABLE activation_pending (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  registration_id TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL,
  owner_cloud_id TEXT NOT NULL,
  instance_id TEXT NOT NULL REFERENCES bootstrap_instance(id),
  device_public_key_hash TEXT NOT NULL,
  nonce TEXT NOT NULL
) STRICT;
CREATE TRIGGER activation_pending_no_update BEFORE UPDATE ON activation_pending BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ACTIVATION_PENDING'); END;
CREATE TRIGGER activation_pending_no_delete BEFORE DELETE ON activation_pending BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ACTIVATION_PENDING'); END;
`;
