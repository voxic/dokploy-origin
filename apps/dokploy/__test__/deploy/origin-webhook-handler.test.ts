import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	eq: vi.fn((field: string, value: unknown) => ({ field, value })),
	and: vi.fn((...conditions: Array<{ field: string; value: unknown }>) => ({
		conditions,
	})),
	originFindFirst: vi.fn(),
	applicationsFindMany: vi.fn(),
	composeFindMany: vi.fn(),
	queueAdd: vi.fn(),
	verify: vi.fn(),
	fetchKeys: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	eq: mocks.eq,
	and: mocks.and,
}));

vi.mock("@/server/db/schema", () => ({
	applications: {
		sourceType: "application.sourceType",
		autoDeploy: "application.autoDeploy",
		triggerType: "application.triggerType",
		originBranch: "application.originBranch",
		originRepository: "application.originRepository",
		originOwner: "application.originOwner",
		originId: "application.originId",
	},
	compose: {
		sourceType: "compose.sourceType",
		autoDeploy: "compose.autoDeploy",
		triggerType: "compose.triggerType",
		originBranch: "compose.originBranch",
		originRepository: "compose.originRepository",
		originOwner: "compose.originOwner",
		originId: "compose.originId",
	},
	origin: {
		originInstallationId: "origin.originInstallationId",
	},
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			origin: {
				findFirst: mocks.originFindFirst,
			},
			applications: {
				findMany: mocks.applicationsFindMany,
			},
			compose: {
				findMany: mocks.composeFindMany,
			},
		},
	},
}));

vi.mock("@dokploy/server", () => ({
	IS_CLOUD: false,
	ORIGIN_PING_EVENT: "ping",
	ORIGIN_PUSH_EVENT: "repository.pushed",
	fetchOriginSigningKeys: mocks.fetchKeys,
	verifyOriginWebhookSignature: mocks.verify,
}));

vi.mock("@/server/queues/queueSetup", () => ({
	myQueue: {
		add: mocks.queueAdd,
	},
}));

vi.mock("@/server/utils/deploy", () => ({
	deploy: vi.fn(),
}));

import handler from "@/pages/api/deploy/origin";

const createResponse = () => {
	const res = {
		status: vi.fn(),
		json: vi.fn(),
		setHeader: vi.fn(),
		end: vi.fn(),
	} as unknown as NextApiResponse & {
		status: ReturnType<typeof vi.fn>;
		json: ReturnType<typeof vi.fn>;
	};
	res.status.mockImplementation(() => res);
	res.json.mockImplementation(() => res);
	return res;
};

const pushBody = {
	installationId: "i_01",
	event: {
		type: "repository.pushed",
		payload: {
			repository: {
				name: "web",
				owner: { slug: "acme" },
			},
			refUpdates: [
				{
					ref: "refs/heads/main",
					after: "abc123",
					deleted: false,
					headCommit: { message: "fix deploy", sha: "abc123" },
				},
			],
		},
	},
};

const createPushRequest = (body = pushBody) => {
	const raw = Buffer.from(JSON.stringify(body));
	return {
		method: "POST",
		headers: {
			"webhook-id": "whd_01",
			"webhook-timestamp": String(Math.floor(Date.now() / 1000)),
			"webhook-signature": "v1ed,AAAA",
			"webhook-event-type": "repository.pushed",
			"webhook-installation-id": "i_01",
		},
		[Symbol.asyncIterator]: async function* () {
			yield raw;
		},
	} as unknown as NextApiRequest;
};

describe("Origin webhook handler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.fetchKeys.mockResolvedValue([]);
		mocks.verify.mockReturnValue(true);
		mocks.originFindFirst.mockResolvedValue({ originId: "or-1" });
		mocks.applicationsFindMany.mockResolvedValue([
			{
				applicationId: "app-1",
				serverId: null,
			},
		]);
		mocks.composeFindMany.mockResolvedValue([]);
	});

	it("rejects invalid signatures", async () => {
		mocks.verify.mockReturnValue(false);
		const res = createResponse();
		await handler(createPushRequest(), res);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(mocks.queueAdd).not.toHaveBeenCalled();
	});

	it("enqueues a deploy for a matching branch push", async () => {
		const res = createResponse();
		await handler(createPushRequest(), res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mocks.queueAdd).toHaveBeenCalledWith(
			"deployments",
			expect.objectContaining({
				applicationId: "app-1",
				applicationType: "application",
			}),
			expect.any(Object),
		);
	});

	it("ignores non-push events after verification", async () => {
		const res = createResponse();
		const req = createPushRequest();
		(req as { headers: Record<string, string> }).headers["webhook-event-type"] =
			"ping";
		await handler(req, res);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(mocks.queueAdd).not.toHaveBeenCalled();
	});
});
