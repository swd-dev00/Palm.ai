CREATE TABLE `local_task_approvals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`userId` int NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`policyJson` text NOT NULL,
	`decidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `local_task_approvals_id` PRIMARY KEY(`id`),
	CONSTRAINT `local_task_approvals_task_idx` UNIQUE(`taskId`)
);
--> statement-breakpoint
CREATE INDEX `local_task_approvals_user_updated_idx` ON `local_task_approvals` (`userId`,`updatedAt`);