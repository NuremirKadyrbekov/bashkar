export const migration = `
CREATE TABLE dining_floor_plans (
 branch_id TEXT PRIMARY KEY REFERENCES activation(branch_id),
 revision INTEGER NOT NULL CHECK(revision>0),
 plan_json TEXT NOT NULL CHECK(length(plan_json)<=262144 AND json_valid(plan_json))
) STRICT;
`;
