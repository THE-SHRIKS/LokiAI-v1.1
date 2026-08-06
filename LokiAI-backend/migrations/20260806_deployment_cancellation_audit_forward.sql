-- Cancellation auditability.
--
-- Before this migration a cancelled deployment recorded only
-- status='cancelled' and the hardcoded string 'Cancelled by user'. There was
-- no way to answer "who or what cancelled this?" — the P0 review could
-- narrow the actor to "the authenticated cancel endpoint" from source alone,
-- but could not attribute a specific incident to a specific actor.
--
-- Progress was also overwritten with 0 on cancel, destroying the evidence of
-- how far the transfer had actually got.

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS cancellation_source TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS cancelled_by_device_id UUID;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS cancellation_request_id TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS superseded_by_deployment_id UUID;

-- Progress at the moment of cancellation, kept separate from `progress` so a
-- cancellation never destroys the real transfer state.
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS progress_at_cancellation INTEGER;

-- Only these sources are meaningful. `unknown_legacy` exists specifically so
-- rows cancelled before this migration are labelled honestly rather than
-- being retroactively attributed to a user who may not have done it.
ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_cancellation_source_check;
ALTER TABLE deployments ADD CONSTRAINT deployments_cancellation_source_check
  CHECK (cancellation_source IS NULL OR cancellation_source IN (
    'user_dashboard', 'user_api', 'device', 'superseded',
    'backend_recovery', 'administrator', 'unknown_legacy'
  ));

-- Backfill: every already-cancelled row predates attribution.
UPDATE deployments
   SET cancellation_source = 'unknown_legacy',
       cancelled_at = COALESCE(cancelled_at, updated_at, deployed_at)
 WHERE status = 'cancelled'
   AND cancellation_source IS NULL;

CREATE INDEX IF NOT EXISTS deployments_cancellation_source_idx
  ON deployments (cancellation_source)
  WHERE cancellation_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS deployments_cancellation_request_idx
  ON deployments (cancellation_request_id)
  WHERE cancellation_request_id IS NOT NULL;
