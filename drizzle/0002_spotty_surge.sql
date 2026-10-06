CREATE TABLE `execution_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`receipt_json` text,
	`signature` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `execution_attempt_run_number` ON `execution_attempts` (`run_id`,`attempt`);