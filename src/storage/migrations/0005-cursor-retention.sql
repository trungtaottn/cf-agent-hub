-- Exclusive retained-prefix floors. Only a committed retention truncation advances these;
-- ordinary deletion and inbox ACK must never change them. NULL means no proven truncation.
ALTER TABLE workspace_metadata ADD COLUMN message_retained_after_created_at INTEGER CHECK(message_retained_after_created_at IS NULL OR (typeof(message_retained_after_created_at)='integer' AND message_retained_after_created_at>=0));
ALTER TABLE workspace_metadata ADD COLUMN message_retained_after_id TEXT CHECK(message_retained_after_id IS NULL OR length(message_retained_after_id)>0);
ALTER TABLE workspace_metadata ADD COLUMN event_retained_after_sequence INTEGER CHECK(event_retained_after_sequence IS NULL OR (typeof(event_retained_after_sequence)='integer' AND event_retained_after_sequence>=0));
