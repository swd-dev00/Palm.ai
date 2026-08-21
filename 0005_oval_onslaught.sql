CREATE TABLE `local_runner_audit_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`runnerId` int,
	`taskId` int,
	`approvalId` int,
	`eventType` varchar(80) NOT NULL,
	`detail` text NOT NULL,
	`metadataJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `local_runner_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `local_task_approvals` MODIFY COLUMN `status` enum('pending','approved','rejected','expired') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `local_runners` ADD `allowedToolsJson` varchar(512) DEFAULT '["inventory_files","extract_text_metadata","profile_csv","write_result_record"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `local_runners` ADD `requiresApprovalForSensitive` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `local_task_approvals` ADD `expiresAt` timestamp NULL;--> statement-breakpoint
UPDATE `local_task_approvals` SET `expiresAt` = NOW() WHERE `expiresAt` IS NULL;--> statement-breakpoint
ALTER TABLE `local_task_approvals` MODIFY COLUMN `expiresAt` timestamp NOT NULL;--> statement-breakpoint
CREATE INDEX `local_runner_audit_user_created_idx` ON `local_runner_audit_events` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `local_runner_audit_runner_created_idx` ON `local_runner_audit_events` (`runnerId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `local_runner_audit_task_created_idx` ON `local_runner_audit_events` (`taskId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `local_task_approvals_expiry_idx` ON `local_task_approvals` (`status`,`expiresAt`);
