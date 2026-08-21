CREATE TABLE `local_approval_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`expiryMinutes` int NOT NULL DEFAULT 15,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `local_approval_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `local_approval_settings_user_idx` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `local_runners` MODIFY COLUMN `allowedToolsJson` varchar(512) NOT NULL DEFAULT '["inventory_files","extract_text_metadata","profile_csv","write_result_record"]';