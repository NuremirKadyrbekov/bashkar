export const migration = `
ALTER TABLE analytics_sync_state ADD COLUMN product_rowid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_sync_state ADD COLUMN product_item_rowid INTEGER NOT NULL DEFAULT 0;
`;
