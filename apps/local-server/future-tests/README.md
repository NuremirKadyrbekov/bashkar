# Future access contract

These tests preserve the original STRICT and editable-permission scenarios before the fixed-SHARED MVP tests were updated. They are intentionally outside the current `pnpm test` target and are **not passing MVP acceptance tests**. Run `pnpm run test:future-access` when work on STRICT or permission editing begins. Do not remove their access-denial assertions to make the current MVP suite green.

Current MVP behavior is tested under `apps/local-server/test`: SHARED is effective for every branch, mode changes through HTTP return `TABLE_MODE_CLOSED`, and permission editing through HTTP returns `PERMISSION_EDITING_CLOSED`. Server-side permission checks remain active.
