import { db } from "@dokploy/server/db";
import {
	type apiCreateOrigin,
	gitProvider,
	origin,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { z } from "zod";

export type Origin = typeof origin.$inferSelect;

export const createOrigin = async (
	input: z.infer<typeof apiCreateOrigin>,
	organizationId: string,
	userId: string,
) => {
	return await db.transaction(async (tx) => {
		const newGitProvider = await tx
			.insert(gitProvider)
			.values({
				providerType: "origin",
				organizationId,
				name: input.name,
				userId,
			})
			.returning()
			.then((response) => response[0]);

		if (!newGitProvider) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Error creating the Git provider",
			});
		}

		return await tx
			.insert(origin)
			.values({
				originAppId: input.originAppId,
				originPrivateKey: input.originPrivateKey,
				originPublicKey: input.originPublicKey,
				originAppName: input.originAppName,
				originWebhookUrl: input.originWebhookUrl,
				gitProviderId: newGitProvider.gitProviderId,
			})
			.returning()
			.then((response) => response[0]);
	});
};

export const findOriginById = async (originId: string) => {
	const originProviderResult = await db.query.origin.findFirst({
		where: eq(origin.originId, originId),
		with: {
			gitProvider: true,
		},
	});

	if (!originProviderResult) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Origin Provider not found",
		});
	}

	return originProviderResult;
};

export const updateOrigin = async (
	originId: string,
	input: Partial<Origin>,
) => {
	return await db
		.update(origin)
		.set({
			...input,
		})
		.where(eq(origin.originId, originId))
		.returning()
		.then((response) => response[0]);
};
