-- Rollback for 20260806_deployment_cancellation_audit_forward.sql.
-- Cancellation attribution is dropped; cancelled rows revert to carrying only
-- status + error_message, as before.

DROP INDEX IF EXISTS deployments_cancellation_request_idx;
DROP INDEX IF EXISTS deployments_cancellation_source_idx;

ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_cancellation_source_check;

ALTER TABLE deployments DROP COLUMN IF EXISTS progress_at_cancellation;
ALTER TABLE deployments DROP COLUMN IF EXISTS superseded_by_deployment_id;
ALTER TABLE deployments DROP COLUMN IF EXISTS cancellation_reason;
ALTER TABLE deployments DROP COLUMN IF EXISTS cancellation_request_id;
ALTER TABLE deployments DROP COLUMN IF EXISTS cancelled_at;
ALTER TABLE deployments DROP COLUMN IF EXISTS cancelled_by_device_id;
ALTER TABLE deployments DROP COLUMN IF EXISTS cancelled_by_user_id;
ALTER TABLE deployments DROP COLUMN IF EXISTS cancellation_source;
