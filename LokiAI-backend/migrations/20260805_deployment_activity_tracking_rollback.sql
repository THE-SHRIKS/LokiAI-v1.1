-- Rollback for 20260805_deployment_activity_tracking_forward.sql

ALTER TABLE deployments DROP COLUMN IF EXISTS updated_at;
