// Old drafts retain their last known timestamp; new drafts record creation separately.
export const migration=`
ALTER TABLE cash_drafts ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0 CHECK(created_at>=0);
UPDATE cash_drafts SET created_at=updated_at;
CREATE TRIGGER cash_draft_creation_immutable BEFORE UPDATE OF created_at ON cash_drafts
WHEN NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_DRAFT_CREATION'); END;
`;
