CREATE TABLE `benchmark_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`count` integer NOT NULL,
	`horizon` real NOT NULL,
	`margin` real NOT NULL,
	`seed` integer NOT NULL,
	`result_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_benchmark_runs_created_at` ON `benchmark_runs` (`created_at`);