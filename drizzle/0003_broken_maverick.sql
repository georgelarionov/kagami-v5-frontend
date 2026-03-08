CREATE TABLE "project_config" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"supervisor_prompt" text,
	"agent_prompts" jsonb,
	"active_tools" jsonb,
	"tool_params" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_config" ADD CONSTRAINT "project_config_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;