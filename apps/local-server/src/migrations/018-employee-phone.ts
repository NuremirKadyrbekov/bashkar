export const migration = `ALTER TABLE employees ADD COLUMN phone TEXT CHECK(phone IS NULL OR length(phone)<=40);`;
