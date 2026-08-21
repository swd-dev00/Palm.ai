ALTER TABLE `task_attachments` MODIFY COLUMN `storageKey` varchar(512);--> statement-breakpoint
ALTER TABLE `task_attachments` MODIFY COLUMN `storageUrl` varchar(512);--> statement-breakpoint
ALTER TABLE `agent_tasks` ADD `executionTarget` enum('auto','local_file','local_browser') DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `local_runners` ADD `runnerType` enum('file','browser') DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE `local_runners` ADD `allowedBrowserToolsJson` varchar(512) DEFAULT '["open_tab","navigate","screenshot","read_page_text","close_tab"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `local_runners` ADD `navigationAllowlistJson` varchar(1024) DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `local_runners` ADD `requiresApprovalForBrowserWrites` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `task_attachments` ADD `source` enum('cloud_upload','local_reference') DEFAULT 'cloud_upload' NOT NULL;--> statement-breakpoint
ALTER TABLE `task_attachments` ADD `localRelativePath` varchar(255);