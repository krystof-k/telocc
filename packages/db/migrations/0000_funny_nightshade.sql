CREATE TYPE "public"."audit_retention_class" AS ENUM('security', 'lifecycle');--> statement-breakpoint
CREATE TYPE "public"."bundle_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."business_number_status" AS ENUM('requested', 'docs_pending', 'bundle_submitted', 'approved', 'rejected', 'active', 'porting_out', 'released');--> statement-breakpoint
CREATE TYPE "public"."call_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."call_session_kind" AS ENUM('inbound', 'dialin');--> statement-breakpoint
CREATE TYPE "public"."call_session_state" AS ENUM('forwarding', 'collecting', 'bridging', 'bridged');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('answered', 'missed', 'declined', 'failed', 'blocked', 'emergency_refused', 'destination_blocked');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner');--> statement-breakpoint
CREATE TYPE "public"."number_class" AS ENUM('geographic', 'nomadic_910', 'mobile');--> statement-breakpoint
CREATE TYPE "public"."office_hours_mode" AS ENUM('schedule', 'always_open', 'always_closed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" DEFAULT 'owner' NOT NULL,
	"personal_number_e164" text,
	"personal_number_verified_at" timestamp with time zone,
	"emergency_ack_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_user_unique" UNIQUE("org_id","user_id"),
	CONSTRAINT "memberships_user_unique" UNIQUE("user_id"),
	CONSTRAINT "memberships_personal_number_e164_check" CHECK ("memberships"."personal_number_e164" IS NULL OR "memberships"."personal_number_e164" ~ '^\+[1-9][0-9]{1,14}$')
);
--> statement-breakpoint
CREATE TABLE "office_hour_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_hour_rules_org_weekday_unique" UNIQUE("org_id","weekday"),
	CONSTRAINT "office_hour_rules_opens_before_closes" CHECK ("office_hour_rules"."opens_at" < "office_hour_rules"."closes_at"),
	CONSTRAINT "office_hour_rules_weekday_range" CHECK ("office_hour_rules"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Prague' NOT NULL,
	"office_hours_mode" "office_hours_mode" DEFAULT 'schedule' NOT NULL,
	"business_capacity_declared_at" timestamp with time zone NOT NULL,
	"declaration_version" text NOT NULL,
	"tos_version" text,
	"tos_accepted_at" timestamp with time zone,
	"contract_summary_shown_at" timestamp with time zone,
	"waiver_accepted_at" timestamp with time zone,
	"dialin_hourly_cap" integer DEFAULT 6 NOT NULL,
	"outbound_daily_minutes_cap" integer DEFAULT 180 NOT NULL,
	"country" char(2) DEFAULT 'CZ' NOT NULL,
	"vat_id" text,
	"vat_vies_status" text,
	"vat_vies_checked_at" timestamp with time zone,
	"customer_type" text DEFAULT 'business' NOT NULL,
	"billing_street" text,
	"billing_city" text,
	"billing_postal" text,
	"billing_country" text,
	"iban_country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"phone_e164" text NOT NULL,
	"pin_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_verifications_phone_e164_check" CHECK ("phone_verifications"."phone_e164" ~ '^\+[1-9][0-9]{1,14}$')
);
--> statement-breakpoint
CREATE TABLE "business_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"e164" text NOT NULL,
	"number_class" "number_class" DEFAULT 'geographic' NOT NULL,
	"status" "business_number_status" DEFAULT 'requested' NOT NULL,
	"area_code" text,
	"provider_number_ref" text,
	"bundle_id" uuid,
	"provider_rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	CONSTRAINT "business_numbers_e164_unique" UNIQUE("e164"),
	CONSTRAINT "business_numbers_e164_check" CHECK ("business_numbers"."e164" ~ '^\+[1-9][0-9]{1,14}$')
);
--> statement-breakpoint
CREATE TABLE "call_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"business_number_id" uuid NOT NULL,
	"provider_call_ref" text NOT NULL,
	"kind" "call_session_kind" NOT NULL,
	"state" "call_session_state" NOT NULL,
	"from_e164" text,
	"target_e164" text,
	"digits_raw" text,
	"answered_at" timestamp with time zone,
	"last_leg_status" text,
	"last_leg_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_sessions_provider_call_ref_unique" UNIQUE("provider_call_ref"),
	CONSTRAINT "call_sessions_from_e164_check" CHECK ("call_sessions"."from_e164" IS NULL OR "call_sessions"."from_e164" ~ '^\+[1-9][0-9]{1,14}$'),
	CONSTRAINT "call_sessions_target_e164_check" CHECK ("call_sessions"."target_e164" IS NULL OR "call_sessions"."target_e164" ~ '^\+[1-9][0-9]{1,14}$')
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"business_number_id" uuid NOT NULL,
	"direction" "call_direction" NOT NULL,
	"status" "call_status" NOT NULL,
	"reason" text,
	"from_e164" text,
	"to_e164" text,
	"initiating_user_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"provider_call_ref" text,
	"provider_error_code" text,
	"anonymised_at" timestamp with time zone,
	CONSTRAINT "calls_from_e164_check" CHECK ("calls"."from_e164" IS NULL OR "calls"."from_e164" ~ '^\+[1-9][0-9]{1,14}$'),
	CONSTRAINT "calls_to_e164_check" CHECK ("calls"."to_e164" IS NULL OR "calls"."to_e164" ~ '^\+[1-9][0-9]{1,14}$')
);
--> statement-breakpoint
CREATE TABLE "dial_policy_prefixes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prefix" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "dial_policy_prefixes_prefix_unique" UNIQUE("prefix")
);
--> statement-breakpoint
CREATE TABLE "region_area_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_name" text NOT NULL,
	"tc_prefix" text NOT NULL,
	CONSTRAINT "region_area_codes_tc_prefix_unique" UNIQUE("tc_prefix")
);
--> statement-breakpoint
CREATE TABLE "end_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"ico" text NOT NULL,
	"street" text NOT NULL,
	"city" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text DEFAULT 'CZ' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "end_users_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"end_user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "kyc_documents_max_5mb" CHECK (octet_length("kyc_documents"."bytes") <= 5242880)
);
--> statement-breakpoint
CREATE TABLE "regulatory_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider_bundle_ref" text,
	"status" "bundle_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"rejection_reason" text
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_user_id" text,
	"type" text NOT NULL,
	"retention_class" "audit_retention_class" DEFAULT 'security' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purge_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"unit_net" numeric(14, 2) NOT NULL,
	"vat_rate" numeric(5, 2) NOT NULL,
	"amount_net" numeric(14, 2) NOT NULL,
	"amount_vat" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text DEFAULT 'CZK' NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"reverse_charge_legend" text,
	"total_net" numeric(14, 2) NOT NULL,
	"total_vat" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_turnover_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"net_czk" numeric(14, 2) NOT NULL,
	CONSTRAINT "org_turnover_years_org_year_unique" UNIQUE("org_id","year")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_hour_rules" ADD CONSTRAINT "office_hour_rules_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_numbers" ADD CONSTRAINT "business_numbers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_numbers" ADD CONSTRAINT "business_numbers_bundle_id_regulatory_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."regulatory_bundles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_business_number_id_business_numbers_id_fk" FOREIGN KEY ("business_number_id") REFERENCES "public"."business_numbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_business_number_id_business_numbers_id_fk" FOREIGN KEY ("business_number_id") REFERENCES "public"."business_numbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_initiating_user_id_user_id_fk" FOREIGN KEY ("initiating_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_bundles" ADD CONSTRAINT "regulatory_bundles_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_turnover_years" ADD CONSTRAINT "org_turnover_years_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "business_numbers_one_active_per_org" ON "business_numbers" USING btree ("org_id") WHERE "business_numbers"."status" <> 'released';--> statement-breakpoint
CREATE UNIQUE INDEX "call_sessions_one_active_dialin_per_org" ON "call_sessions" USING btree ("org_id") WHERE "call_sessions"."kind" = 'dialin' AND "call_sessions"."state" IN ('collecting', 'bridging', 'bridged');--> statement-breakpoint
CREATE INDEX "calls_org_started_at_idx" ON "calls" USING btree ("org_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "calls_provider_call_ref_unique" ON "calls" USING btree ("provider_call_ref") WHERE "calls"."provider_call_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_events_org_created_idx" ON "audit_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_retention_created_idx" ON "audit_events" USING btree ("retention_class","created_at");