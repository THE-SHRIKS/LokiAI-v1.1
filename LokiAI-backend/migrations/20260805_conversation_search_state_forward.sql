-- Explicit structured search state per conversation (active capability,
-- hard constraints, shown/rejected/failed/deployed candidate ids, search
-- cursor) so repetition prevention and task-change handling read a real
-- persisted record instead of re-deriving it from raw chat history on
-- every turn.
-- Safe to run repeatedly and during rolling backend deploys.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS search_state JSONB NOT NULL DEFAULT '{}'::jsonb;
