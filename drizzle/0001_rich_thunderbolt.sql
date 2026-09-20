CREATE TABLE `camera_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`object_label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`reference_elapsed_ms` integer,
	`calibration_ratio` real
);
--> statement-breakpoint
CREATE INDEX `idx_camera_runs_created_at` ON `camera_runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `camera_samples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`elapsed_ms` integer NOT NULL,
	`scale` real NOT NULL,
	`raw_ttc` real,
	`quality` real NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `camera_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_camera_samples_run_elapsed` ON `camera_samples` (`run_id`,`elapsed_ms`);