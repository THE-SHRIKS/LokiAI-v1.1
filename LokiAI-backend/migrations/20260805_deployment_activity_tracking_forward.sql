-- Tracks the last time a deployment actually heard from the phone (any
-- progress/status/runtime-event report), separate from deployed_at
-- (creation time). Without this, staleness checks based on deployed_at
-- either killed genuinely slow-but-progressing downloads once they passed
-- the timeout, or let a truly dead deployment block new deployments on the
-- same device for the full timeout window no matter how long it had
-- actually been silent.
-- Safe to run repeatedly and during rolling backend deploys.

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
