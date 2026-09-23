import { relations } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { gitProvider } from "./git-provider";
import { encryptedText } from "./utils";

export const origin = pgTable("origin", {
	originId: text("originId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	originAppId: text("originAppId"),
	originAppName: text("originAppName"),
	originPrivateKey: encryptedText("originPrivateKey"),
	originPublicKey: text("originPublicKey"),
	originInstallationId: text("originInstallationId"),
	originWebhookUrl: text("originWebhookUrl"),
	gitProviderId: text("gitProviderId")
		.notNull()
		.references(() => gitProvider.gitProviderId, { onDelete: "cascade" }),
});

export const originProviderRelations = relations(origin, ({ one }) => ({
	gitProvider: one(gitProvider, {
		fields: [origin.gitProviderId],
		references: [gitProvider.gitProviderId],
	}),
}));

export const apiCreateOrigin = z.object({
	name: z.string().min(1),
	originAppId: z.string().min(1),
	originPrivateKey: z.string().min(1),
	originPublicKey: z.string().optional(),
	originAppName: z.string().optional(),
	originWebhookUrl: z
		.string()
		.url()
		.startsWith("https://", "Callback and webhook URLs must be https")
		.optional(),
});

export const apiFindOneOrigin = z.object({
	originId: z.string().min(1),
});

export const apiFindOriginBranches = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1),
	originId: z.string().optional(),
});

export const apiUpdateOrigin = z.object({
	originId: z.string().min(1),
	gitProviderId: z.string().min(1),
	name: z.string().min(1),
	originAppId: z.string().min(1).optional(),
	originPrivateKey: z.string().min(1).optional(),
	originPublicKey: z.string().optional(),
	originAppName: z.string().optional(),
	originWebhookUrl: z
		.string()
		.url()
		.startsWith("https://", "Callback and webhook URLs must be https")
		.optional(),
});
