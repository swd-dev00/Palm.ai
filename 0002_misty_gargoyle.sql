CREATE TABLE `runner_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`taskId` int NOT NULL,
	`eventSeq` int NOT NULL,
	`source` enum('control_plane','github_actions','runner','artifact_store') NOT NULL,
	`type` varchar(96) NOT NULL,
	`status` varchar(48) NOT NULL,
	`detail` text NOT NULL,
	`dataJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `runner_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `runner_events_run_sequence_idx` UNIQUE(`runId`,`eventSeq`)
);
--> statement-breakpoint
CREATE TABLE `runner_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`provider` enum('local','github_actions') NOT NULL,
	`runnerClass` varchar(64) NOT NULL DEFAULT 'standard',
	`status` enum('queued','dispatching','provisioning','running','collecting','completed','failed','cancellation_requested','cancelled') NOT NULL DEFAULT 'queued',
	`idempotencyKey` varchar(128) NOT NULL,
	`githubWorkflowRunId` varchar(32),
	`githubWorkflowRunUrl` varchar(512),
	`policyJson` text,
	`errorMessage` text,
	`dispatchedAt` timestamp,
	`startedAt` timestamp,
	`endedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `runner_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `runner_runs_idempotency_idx` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE INDEX `runner_events_task_created_idx` ON `runner_events` (`taskId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `runner_runs_task_created_idx` ON `runner_runs` (`taskId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `runner_runs_github_workflow_idx` ON `runner_runs` (`githubWorkflowRunId`);