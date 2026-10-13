CREATE TABLE "agent_chat"."memory_optimization_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"usage_record_id" text
);
--> statement-breakpoint
ALTER TABLE "agent_chat"."memory_notes" ADD COLUMN "merged_into" text;--> statement-breakpoint
CREATE INDEX "memory_optimization_runs_owner_started_idx" ON "agent_chat"."memory_optimization_runs" USING btree ("owner_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_optimization_runs_one_running_idx" ON "agent_chat"."memory_optimization_runs" USING btree ("owner_id") WHERE "agent_chat"."memory_optimization_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "memory_notes_merged_into_idx" ON "agent_chat"."memory_notes" USING btree ("merged_into");