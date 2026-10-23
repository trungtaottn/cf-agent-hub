-- Existing sessions and attempts have no proven issuance epoch and stay invalid.
ALTER TABLE sessions ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0 CHECK(auth_epoch>=0 AND auth_epoch<=9007199254740991);
ALTER TABLE login_attempts ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0 CHECK(auth_epoch>=0 AND auth_epoch<=9007199254740991);
ALTER TABLE login_attempts ADD COLUMN return_path TEXT NOT NULL DEFAULT '/' CHECK(return_path IN ('/','/overview','/inbox','/activity','/settings'));
