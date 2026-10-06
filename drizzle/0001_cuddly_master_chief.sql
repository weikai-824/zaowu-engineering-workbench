CREATE TABLE `execution_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`public_key` text NOT NULL,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `execution_devices_owner` ON `execution_devices` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `execution_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`job_id` text NOT NULL,
	`device_id` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer NOT NULL,
	`lease_id` text,
	`lease_until` integer,
	`input_sha256` text NOT NULL,
	`runner_sha256` text NOT NULL,
	`receipt_json` text,
	`signature` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_runs_job` ON `execution_runs` (`job_id`);--> statement-breakpoint
CREATE INDEX `execution_runs_owner_device_status` ON `execution_runs` (`owner_id`,`device_id`,`status`);--> statement-breakpoint
CREATE INDEX `execution_runs_project` ON `execution_runs` (`owner_id`,`project_id`);