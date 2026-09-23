ALTER TYPE "public"."sourceType" ADD VALUE 'origin' BEFORE 'drop';--> statement-breakpoint
ALTER TYPE "public"."sourceTypeCompose" ADD VALUE 'origin' BEFORE 'raw';--> statement-breakpoint
ALTER TYPE "public"."gitProviderType" ADD VALUE 'origin';--> statement-breakpoint
CREATE TABLE "origin" (
	"originId" text PRIMARY KEY NOT NULL,
	"originAppId" text,
	"originAppName" text,
	"originPrivateKey" text,
	"originPublicKey" text,
	"originInstallationId" text,
	"originWebhookUrl" text,
	"gitProviderId" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "originRepository" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "originOwner" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "originBranch" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "originBuildPath" text DEFAULT '/';--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "originId" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "originRepository" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "originOwner" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "originBranch" text;--> statement-breakpoint
ALTER TABLE "compose" ADD COLUMN "originId" text;--> statement-breakpoint
ALTER TABLE "origin" ADD CONSTRAINT "origin_gitProviderId_git_provider_gitProviderId_fk" FOREIGN KEY ("gitProviderId") REFERENCES "public"."git_provider"("gitProviderId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_originId_origin_originId_fk" FOREIGN KEY ("originId") REFERENCES "public"."origin"("originId") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compose" ADD CONSTRAINT "compose_originId_origin_originId_fk" FOREIGN KEY ("originId") REFERENCES "public"."origin"("originId") ON DELETE set null ON UPDATE no action;
