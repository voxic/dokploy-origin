import {
	findOriginById,
	updateOrigin,
	validateRequest,
	verifyOriginInstallationReceipt,
} from "@dokploy/server";
import { hasPermission } from "@dokploy/server/services/permission";
import type { NextApiRequest, NextApiResponse } from "next";

type Query = {
	installation_receipt?: string;
	state?: string;
};

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	const { installation_receipt, state }: Query = req.query as Query;

	if (!installation_receipt || !state) {
		return res.status(400).json({ error: "Missing installation receipt" });
	}

	const { user, session } = await validateRequest(req);
	if (!user || !session?.activeOrganizationId) {
		return res.status(401).json({ error: "Unauthorized" });
	}

	const ctx = {
		user: { id: user.id },
		session: { activeOrganizationId: session.activeOrganizationId },
	};

	if (!(await hasPermission(ctx, { gitProviders: ["create"] }))) {
		return res.status(403).json({ error: "Forbidden" });
	}

	const [, originId] = state.split(":");
	if (!originId) {
		return res.status(400).json({ error: "Missing Origin provider id" });
	}

	try {
		const provider = await findOriginById(originId);
		if (
			provider.gitProvider.organizationId !== session.activeOrganizationId ||
			!provider.originAppId
		) {
			return res.status(404).json({ error: "Origin provider not found" });
		}

		const claims = await verifyOriginInstallationReceipt(installation_receipt, {
			appId: provider.originAppId,
			state,
		});

		await updateOrigin(originId, {
			originInstallationId: claims.sub,
		});
	} catch {
		return res.status(400).json({ error: "Invalid installation receipt" });
	}

	res.redirect(307, "/dashboard/settings/git-providers");
}
