CREATE TABLE `local_audit_filter_presets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`label` varchar(80) NOT NULL,
	`filterJson` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `local_audit_filter_presets_id` PRIMARY KEY(`id`),
	CONSTRAINT `local_audit_filter_presets_user_label_idx` UNIQUE(`userId`,`label`)
);
--> statement-breakpoint
CREATE INDEX `local_audit_filter_presets_user_updated_idx` ON `local_audit_filter_presets` (`userId`,`updatedAt`);