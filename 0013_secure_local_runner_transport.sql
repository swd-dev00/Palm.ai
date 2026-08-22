ALTER TABLE `runner_runs` ADD `localRunnerId` int;
--> statement-breakpoint
CREATE INDEX `runner_runs_local_runner_idx` ON `runner_runs` (`localRunnerId`,`createdAt`);
--> statement-breakpoint
CREATE TABLE `local_runner_request_nonces` (
  `id` int AUTO_INCREMENT NOT NULL,
  `runnerId` int NOT NULL,
  `nonce` varchar(96) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `local_runner_request_nonces_id` PRIMARY KEY(`id`),
  CONSTRAINT `local_runner_request_nonce_unique_idx` UNIQUE(`runnerId`,`nonce`)
);
--> statement-breakpoint
CREATE INDEX `local_runner_request_nonce_expiry_idx` ON `local_runner_request_nonces` (`expiresAt`);
