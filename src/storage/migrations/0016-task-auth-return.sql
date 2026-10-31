-- Forward-only auth return amendment. Retain every historical attempt and rowid.
CREATE TABLE login_attempts_with_tasks (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,state_digest TEXT NOT NULL UNIQUE,nonce TEXT NOT NULL,
 pkce_verifier TEXT NOT NULL,cookie_digest TEXT NOT NULL,redirect_uri TEXT NOT NULL,created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,consumed_at INTEGER,
 auth_epoch INTEGER NOT NULL DEFAULT 0 CHECK(auth_epoch>=0 AND auth_epoch<=9007199254740991),
 return_path TEXT NOT NULL DEFAULT '/' CHECK(return_path IN ('/','/overview','/inbox','/activity','/settings','/tasks')),
 CHECK(expires_at>created_at)
);
INSERT INTO login_attempts_with_tasks(rowid,id,workspace_id,state_digest,nonce,pkce_verifier,cookie_digest,redirect_uri,created_at,expires_at,consumed_at,auth_epoch,return_path)
 SELECT rowid,id,workspace_id,state_digest,nonce,pkce_verifier,cookie_digest,redirect_uri,created_at,expires_at,consumed_at,auth_epoch,return_path FROM login_attempts;
DROP TABLE login_attempts;
ALTER TABLE login_attempts_with_tasks RENAME TO login_attempts;
CREATE INDEX login_attempts_expiry ON login_attempts(expires_at);
