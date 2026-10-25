-- A retained monotonic fence prevents pre-maintenance callbacks from publishing after resume.
ALTER TABLE maintenance_state ADD COLUMN generation INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(generation)='integer' AND generation>=0 AND generation<=9007199254740991);
