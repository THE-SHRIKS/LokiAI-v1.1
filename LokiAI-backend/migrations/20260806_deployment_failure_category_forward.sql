-- Adds a machine-readable failure category to deployments, separate from
-- the free-text error_message. Without this, a deterministic runtime
-- failure (checksum_failed, adapter_validation_failed, smoke_test_failed)
-- and a pure delivery/timeout failure (transport_timeout, device_offline)
-- were indistinguishable in the row itself, so a late authoritative phone
-- "ready" event could not be safely allowed to supersede one but not the
-- other (Part 4 of the deployment-state-machine spec: a late ready may
-- supersede a transport_timeout/device_offline, but must never silently
-- supersede an explicit cancellation or a deterministic corrupt-artifact
-- failure without fresh validation evidence).
--
-- Safe to run repeatedly and during rolling backend deploys: additive,
-- nullable, no backfill required (existing rows simply have no category,
-- which the code treats as "unknown" — never as grounds to supersede).
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS failure_category TEXT;

CREATE INDEX IF NOT EXISTS idx_deployments_device_status
    ON deployments (device_id, status);
