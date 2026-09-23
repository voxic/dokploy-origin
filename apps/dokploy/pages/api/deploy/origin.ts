import {
	fetchOriginSigningKeys,
	IS_CLOUD,
	ORIGIN_PING_EVENT,
	ORIGIN_PUSH_EVENT,
	verifyOriginWebhookSignature,
} from "@dokploy/server";
import { db } from "@dokploy/server/db";
import { and, eq } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";
import { applications, compose, origin } from "@/server/db/schema";
import type { DeploymentJob } from "@/server/queues/queue-types";
import { myQueue } from "@/server/queues/queueSetup";
import { deploy } from "@/server/utils/deploy";
import { logWebhookError } from "./[refreshToken]";

export const config = {
	api: {
		bodyParser: false,
	},
};

const readRawBody = async (req: NextApiRequest) => {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
};

const headerValue = (value: string | string[] | undefined) =>
	Array.isArray(value) ? value[0] : value;

const enqueue = async (jobData: DeploymentJob, serverId: string | null) => {
	if (IS_CLOUD && serverId) {
		jobData.serverId = serverId;
		deploy(jobData).catch((error) => {
			console.error("Background deployment failed:", error);
		});
		return;
	}
	await myQueue.add(
		"deployments",
		{ ...jobData },
		{
			removeOnComplete: true,
			removeOnFail: true,
		},
	);
};

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "POST") {
		res.setHeader("Allow", ["POST"]);
		return res.status(405).end(`Method ${req.method} not allowed`);
	}

	const rawBody = await readRawBody(req);
	const headers = {
		"webhook-id": headerValue(req.headers["webhook-id"]),
		"webhook-timestamp": headerValue(req.headers["webhook-timestamp"]),
		"webhook-signature": headerValue(req.headers["webhook-signature"]),
		"webhook-event-type": headerValue(req.headers["webhook-event-type"]),
		"webhook-installation-id": headerValue(
			req.headers["webhook-installation-id"],
		),
	};

	let keys: JsonWebKey[];
	try {
		keys = await fetchOriginSigningKeys();
	} catch (error) {
		logWebhookError("Failed to fetch Origin signing keys:", error);
		res.status(500).json({ message: "Unable to verify Origin webhook" });
		return;
	}

	if (!verifyOriginWebhookSignature(rawBody, headers, keys)) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	const eventType = headers["webhook-event-type"];
	if (eventType === ORIGIN_PING_EVENT) {
		res.status(200).json({ message: "Ping received, webhook is active" });
		return;
	}

	if (eventType !== ORIGIN_PUSH_EVENT) {
		res.status(200).json({ message: "Ignored event" });
		return;
	}

	let envelope: {
		installationId?: string;
		event?: {
			payload?: {
				repository?: {
					name?: string;
					owner?: { slug?: string };
				};
				refUpdates?: Array<{
					ref?: string;
					after?: string;
					deleted?: boolean;
					headCommit?: { message?: string; sha?: string };
				}>;
			};
		};
	};

	try {
		envelope = JSON.parse(rawBody.toString("utf8"));
	} catch {
		res.status(400).json({ message: "Invalid JSON" });
		return;
	}

	const installationId =
		headers["webhook-installation-id"] || envelope.installationId;
	if (!installationId) {
		res.status(400).json({ message: "Origin Installation not found" });
		return;
	}

	const originResult = await db.query.origin.findFirst({
		where: eq(origin.originInstallationId, installationId),
	});

	if (!originResult) {
		res.status(400).json({ message: "Origin Installation not found" });
		return;
	}

	const payload = envelope.event?.payload;
	const owner = payload?.repository?.owner?.slug;
	const repository = payload?.repository?.name;
	const refUpdates = (payload?.refUpdates ?? []).filter(
		(update) => !update.deleted,
	);

	if (!owner || !repository || refUpdates.length === 0) {
		res.status(200).json({ message: "No deployable ref updates" });
		return;
	}

	try {
		for (const update of refUpdates) {
			const ref = update.ref ?? "";
			const isTag = ref.startsWith("refs/tags/");
			const refName = isTag
				? ref.replace("refs/tags/", "")
				: ref.replace("refs/heads/", "");
			if (!refName) {
				continue;
			}

			const triggerType = isTag ? "tag" : "push";
			const deploymentTitle =
				update.headCommit?.message ||
				(isTag ? `Tag created: ${refName}` : `Push to ${refName}`);
			const deploymentHash = update.headCommit?.sha || update.after || "";

			const appFilters = [
				eq(applications.sourceType, "origin"),
				eq(applications.autoDeploy, true),
				eq(applications.triggerType, triggerType),
				eq(applications.originRepository, repository),
				eq(applications.originOwner, owner),
				eq(applications.originId, originResult.originId),
			];
			if (!isTag) {
				appFilters.push(eq(applications.originBranch, refName));
			}

			const apps = await db.query.applications.findMany({
				where: and(...appFilters),
			});

			for (const app of apps) {
				const jobData: DeploymentJob = {
					applicationId: app.applicationId as string,
					titleLog: deploymentTitle,
					descriptionLog: `Hash: ${deploymentHash}`,
					type: "deploy",
					applicationType: "application",
					server: !!app.serverId,
				};
				await enqueue(jobData, app.serverId);
			}

			const composeFilters = [
				eq(compose.sourceType, "origin"),
				eq(compose.autoDeploy, true),
				eq(compose.triggerType, triggerType),
				eq(compose.originRepository, repository),
				eq(compose.originOwner, owner),
				eq(compose.originId, originResult.originId),
			];
			if (!isTag) {
				composeFilters.push(eq(compose.originBranch, refName));
			}

			const composeApps = await db.query.compose.findMany({
				where: and(...composeFilters),
			});

			for (const composeApp of composeApps) {
				const jobData: DeploymentJob = {
					composeId: composeApp.composeId as string,
					titleLog: deploymentTitle,
					type: "deploy",
					applicationType: "compose",
					descriptionLog: `Hash: ${deploymentHash}`,
					server: !!composeApp.serverId,
				};
				await enqueue(jobData, composeApp.serverId);
			}
		}

		res.status(200).json({ message: "Origin push processed" });
	} catch (error) {
		logWebhookError("Error deploying Origin applications:", error);
		res.status(400).json({ message: "Error deploying Origin applications" });
	}
}
