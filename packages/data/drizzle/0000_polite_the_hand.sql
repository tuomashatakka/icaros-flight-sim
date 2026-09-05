CREATE TABLE "match_players" (
	"match_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"team" text NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	"captures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "match_players_match_id_name_pk" PRIMARY KEY("match_id","name")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"arena" text NOT NULL,
	"started_at" bigint NOT NULL,
	"ended_at" bigint,
	"winner" text,
	"scores" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "oauth_accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "race_results" (
	"match_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"laps" integer DEFAULT 0 NOT NULL,
	"total_time" real,
	"best_lap" real,
	"lap_times" jsonb NOT NULL,
	"finished" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "race_results_match_id_name_pk" PRIMARY KEY("match_id","name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp,
	"image" text,
	"username" text NOT NULL,
	"password_hash" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_players_user" ON "match_players" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "race_results_user" ON "race_results" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username" ON "users" USING btree (lower("username"));