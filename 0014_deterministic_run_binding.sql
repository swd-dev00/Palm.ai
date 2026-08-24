-- Migration: 0014_deterministic_run_binding
-- Description: Add provider tracking and quota context to runs table for UTC daily window counting

ALTER TABLE runs 
ADD COLUMN provider VARCHAR(50) NOT NULL DEFAULT 'local',
ADD COLUMN quota_context JSONB;

CREATE INDEX idx_runs_user_provider_created 
ON runs(user_id, provider, created_at);
