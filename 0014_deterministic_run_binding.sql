ALTER TABLE `runner_runs` MODIFY `status` enum('queued','claimable','claimed','dispatching','provisioning','running','collecting','completed','failed','cancellation_requested','cancelled') NOT NULL DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE `runner_runs` ADD `userId` int;--> statement-breakpoint
UPDATE `runner_runs` rr JOIN `agent_tasks` t ON t.`id` = rr.`taskId` SET rr.`userId` = t.`userId` WHERE rr.`userId` IS NULL;--> statement-breakpoint
ALTER TABLE `runner_runs` MODIFY `userId` int NOT NULL;--> statement-breakpoint
CREATE INDEX `runner_runs_user_provider_status_idx` ON `runner_runs` (`userId`,`provider`,`status`);
