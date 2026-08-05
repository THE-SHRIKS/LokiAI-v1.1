-- Rollback for runtime validation telemetry.
-- Keeps model/deployment rows but removes additive telemetry structures.

DROP INDEX IF EXISTS runtime_events_deployment_time_idx;
DROP INDEX IF EXISTS runtime_events_device_time_idx;
DROP TABLE IF EXISTS runtime_events;

ALTER TABLE deployments DROP COLUMN IF EXISTS adapter_id;
ALTER TABLE deployments DROP COLUMN IF EXISTS adapter_version;
ALTER TABLE deployments DROP COLUMN IF EXISTS runtime_version;
ALTER TABLE deployments DROP COLUMN IF EXISTS artifact_fingerprint;
ALTER TABLE deployments DROP COLUMN IF EXISTS validation_result;
ALTER TABLE deployments DROP COLUMN IF EXISTS initialization_result;
ALTER TABLE deployments DROP COLUMN IF EXISTS smoke_test_result;
ALTER TABLE deployments DROP COLUMN IF EXISTS failure_code;
ALTER TABLE deployments DROP COLUMN IF EXISTS failure_details;
