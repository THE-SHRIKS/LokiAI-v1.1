-- Rollback for 20260806_deployment_failure_category_forward.sql.
DROP INDEX IF EXISTS idx_deployments_device_status;
ALTER TABLE deployments DROP COLUMN IF EXISTS failure_category;
