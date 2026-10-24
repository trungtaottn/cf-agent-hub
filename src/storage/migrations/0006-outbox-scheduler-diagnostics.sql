-- Persist bounded scheduler diagnostics without response bodies or provider exception text.
ALTER TABLE scheduler_state ADD COLUMN last_error_code TEXT CHECK(last_error_code IS NULL OR last_error_code IN ('ALARM_ARM_FAILED','DUE_WORK_FAILED'));
