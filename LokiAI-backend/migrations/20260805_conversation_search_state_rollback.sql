-- Rollback for 20260805_conversation_search_state_forward.sql

ALTER TABLE conversations DROP COLUMN IF EXISTS search_state;
