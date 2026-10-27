-- Bound complete catalog reference queries by matches, not unrelated workspace size.
-- Forward-only indexes: schema8 rows, constraints and historical snapshots are unchanged.
CREATE INDEX tasks_catalog_project ON tasks(workspace_id,project_id,id);
CREATE INDEX tasks_catalog_role ON tasks(workspace_id,work_role_id,id);
