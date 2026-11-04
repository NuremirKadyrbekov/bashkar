export const migration = `
CREATE TABLE sales_catalog_pin_state (
 branch_id TEXT PRIMARY KEY REFERENCES activation(branch_id),
 revision INTEGER NOT NULL CHECK(revision>0)
) STRICT;
CREATE TABLE sales_catalog_pins (
 branch_id TEXT NOT NULL REFERENCES activation(branch_id),
 category_id TEXT NOT NULL,
 item_id TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position>0),
 PRIMARY KEY(branch_id,category_id,item_id)
) STRICT;
CREATE INDEX sales_catalog_pins_order ON sales_catalog_pins(branch_id,category_id,position DESC);
`;
