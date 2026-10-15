CREATE TABLE "agent_chat"."skill_loads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"chat_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"loaded_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."skill_versions" (
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"when_to_use" text NOT NULL,
	"body" text NOT NULL,
	"author" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "skill_versions_name_version_pk" PRIMARY KEY("name","version")
);
--> statement-breakpoint
CREATE TABLE "agent_chat"."skills" (
	"name" text PRIMARY KEY NOT NULL,
	"when_to_use" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "skill_loads_name_loaded_idx" ON "agent_chat"."skill_loads" USING btree ("name","loaded_at");