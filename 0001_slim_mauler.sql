CREATE TABLE `agent_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int,
	`title` varchar(180) NOT NULL,
	`prompt` text NOT NULL,
	`status` enum('queued','running','completed','error') NOT NULL DEFAULT 'queued',
	`assistantResponse` text,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `agent_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `execution_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`stepOrder` int NOT NULL,
	`kind` enum('plan','tool','decision','result') NOT NULL,
	`status` enum('pending','running','completed','error') NOT NULL DEFAULT 'pending',
	`label` varchar(180) NOT NULL,
	`detail` text,
	`toolName` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `execution_steps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(160) NOT NULL,
	`description` text,
	`accent` varchar(24) NOT NULL DEFAULT 'indigo',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `skill_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`skillSlug` varchar(80) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `skill_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_attachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`userId` int NOT NULL,
	`originalName` varchar(255) NOT NULL,
	`mimeType` varchar(120) NOT NULL,
	`fileSize` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`storageUrl` varchar(512) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `task_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `agent_tasks_user_updated_idx` ON `agent_tasks` (`userId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `agent_tasks_project_updated_idx` ON `agent_tasks` (`projectId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `execution_steps_task_order_idx` ON `execution_steps` (`taskId`,`stepOrder`);--> statement-breakpoint
CREATE INDEX `projects_user_created_idx` ON `projects` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `skill_settings_user_slug_idx` ON `skill_settings` (`userId`,`skillSlug`);--> statement-breakpoint
CREATE INDEX `task_attachments_task_idx` ON `task_attachments` (`taskId`);--> statement-breakpoint
CREATE INDEX `task_messages_task_created_idx` ON `task_messages` (`taskId`,`createdAt`);