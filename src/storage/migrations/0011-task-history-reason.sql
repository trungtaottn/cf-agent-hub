-- Private command reason; legacy NULL means no reason was recorded, not an empty reason.
ALTER TABLE task_history ADD COLUMN reason TEXT;
