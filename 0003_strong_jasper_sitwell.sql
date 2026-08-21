CREATE TABLE `local_runners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`label` varchar(120) NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`status` enum('offline','online','revoked') NOT NULL DEFAULT 'offline',
	`lastSeenAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `local_runners_id` PRIMARY KEY(`id`),
	CONSTRAINT `local_runners_token_hash_idx` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE INDEX `local_runners_user_updated_idx` ON `local_runners` (`userId`,`updatedAt`);