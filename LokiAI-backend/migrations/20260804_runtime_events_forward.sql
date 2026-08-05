-- Runtime validation telemetry and deployment readiness evidence.
-- Safe to run repeatedly and during rolling backend deploys.

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS adapter_id TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS adapter_version TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS runtime_version TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS artifact_fingerprint TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS validation_result JSONB;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS initialization_result JSONB;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS smoke_test_result JSONB;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS failure_code TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS failure_details TEXT;

CREATE TABLE IF NOT EXISTS runtime_events (
    event_id        TEXT PRIMARY KEY,
    schema_version  INTEGER NOT NULL,
    device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    deployment_id   UUID,
    model_id        TEXT,
    adapter_id      TEXT,
    adapter_version TEXT,
    runtime_epoch   TEXT,
    request_id      TEXT,
    operation       TEXT,
    event_type      TEXT NOT NULL,
    success         BOOLEAN,
    error_code      TEXT,
    error_detail    TEXT,
    memory_snapshot JSONB,
    correlation_id  TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS runtime_events_device_time_idx
    ON runtime_events (device_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS runtime_events_deployment_time_idx
    ON runtime_events (deployment_id, occurred_at DESC);

UPDATE deployments
SET status = 'downloaded'
WHERE status = 'complete'
  AND smoke_test_result IS NULL
  AND validation_result IS NULL;
