import {
	assertGitProviderAccess,
	canViewGitProviderSecrets,
	createOrigin,
	findOriginById,
	generateOriginKeypair,
	getAccessibleGitProviderIds,
	getOriginBranches,
	getOriginRepositories,
	haveOriginRequirements,
	originInstallUrl,
	updateGitProvider,
	updateOrigin,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
	createTRPCRouter,
	protectedProcedure,
	withPermission,
} from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";
import {
	apiCreateOrigin,
	apiFindOneOrigin,
	apiFindOriginBranches,
	apiUpdateOrigin,
} from "@/server/db/schema";

export const originRouter = createTRPCRouter({
	create: withPermission("gitProviders", "create")
		.input(apiCreateOrigin)
		.mutation(async ({ input, ctx }) => {
			const result = await createOrigin(
				input,
				ctx.session.activeOrganizationId,
				ctx.session.userId,
			);

			await audit(ctx, {
				action: "create",
				resourceType: "gitProvider",
				resourceId: result?.originId ?? "",
				resourceName: input.name,
			});

			return result;
		}),
	generateKeypair: withPermission("gitProviders", "create").mutation(() => {
		return generateOriginKeypair();
	}),
	one: protectedProcedure
		.input(apiFindOneOrigin)
		.query(async ({ input, ctx }) => {
			const origin = await findOriginById(input.originId);
			await assertGitProviderAccess(ctx.session, origin.gitProvider);

			if (!(await canViewGitProviderSecrets(ctx.session, origin.gitProvider))) {
				return {
					...origin,
					originPrivateKey: null,
				};
			}

			return origin;
		}),
	getOriginRepositories: protectedProcedure
		.input(apiFindOneOrigin)
		.query(async ({ input, ctx }) => {
			const origin = await findOriginById(input.originId);
			await assertGitProviderAccess(ctx.session, origin.gitProvider);
			return await getOriginRepositories(input.originId);
		}),
	getOriginBranches: protectedProcedure
		.input(apiFindOriginBranches)
		.query(async ({ input, ctx }) => {
			if (input.originId) {
				const origin = await findOriginById(input.originId);
				await assertGitProviderAccess(ctx.session, origin.gitProvider);
			}
			return await getOriginBranches(input);
		}),
	originProviders: protectedProcedure.query(async ({ ctx }) => {
		const accessibleIds = await getAccessibleGitProviderIds(ctx.session);

		let result = await db.query.origin.findMany({
			with: {
				gitProvider: true,
			},
		});

		result = result.filter(
			(provider) =>
				provider.gitProvider.organizationId ===
					ctx.session.activeOrganizationId &&
				accessibleIds.has(provider.gitProvider.gitProviderId),
		);

		return result
			.filter((provider) => haveOriginRequirements(provider))
			.map((provider) => ({
				originId: provider.originId,
				gitProvider: {
					...provider.gitProvider,
				},
			}));
	}),
	getInstallUrl: protectedProcedure
		.input(
			z.object({
				originId: z.string().min(1),
				redirectUri: z
					.string()
					.url()
					.startsWith("https://", "Callback URL must be https"),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const origin = await findOriginById(input.originId);
			await assertGitProviderAccess(ctx.session, origin.gitProvider);
			if (!origin.originAppId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Origin App ID is missing",
				});
			}
			const state = `origin_setup:${origin.originId}:${nanoid()}`;
			return {
				state,
				url: originInstallUrl({
					appId: origin.originAppId,
					redirectUri: input.redirectUri,
					state,
				}),
			};
		}),
	testConnection: protectedProcedure
		.input(apiFindOneOrigin)
		.mutation(async ({ input, ctx }) => {
			try {
				const origin = await findOriginById(input.originId);
				await assertGitProviderAccess(ctx.session, origin.gitProvider);
				const result = await getOriginRepositories(input.originId);
				return `Found ${result.length} repositories`;
			} catch (err) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: err instanceof Error ? err.message : `Error: ${err}`,
				});
			}
		}),
	update: withPermission("gitProviders", "create")
		.input(apiUpdateOrigin)
		.mutation(async ({ input, ctx }) => {
			await updateGitProvider(input.gitProviderId, {
				name: input.name,
				organizationId: ctx.session.activeOrganizationId,
			});

			await updateOrigin(input.originId, {
				originAppId: input.originAppId,
				originPrivateKey: input.originPrivateKey,
				originPublicKey: input.originPublicKey,
				originAppName: input.originAppName,
				originWebhookUrl: input.originWebhookUrl,
			});

			await audit(ctx, {
				action: "update",
				resourceType: "gitProvider",
				resourceId: input.gitProviderId,
				resourceName: input.name,
			});
		}),
});
