-- Ordered covering seeks for the existing shared scheduler; no domain row changes.
CREATE INDEX outbox_pending_order ON outbox(status,next_due_at,id);
CREATE INDEX outbox_lease_order ON outbox(status,lease_expires_at,id);
