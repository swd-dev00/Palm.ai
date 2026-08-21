CREATE TABLE `local_audit_export_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`runnerId` int NOT NULL,
	`label` varchar(80) NOT NULL,
	`columnsJson` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `local_audit_export_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `local_audit_export_templates_user_runner_label_idx` UNIQUE(`userId`,`runnerId`,`label`)
);
--> statement-breakpoint
CREATE INDEX `local_audit_export_templates_user_runner_updated_idx` ON `local_audit_export_templates` (`userId`,`runnerId`,`updatedAt`);