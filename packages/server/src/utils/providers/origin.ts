import {
	createHash,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	sign,
	verify,
} from "node:crypto";
import { join } from "node:path";
import { paths } from "@dokploy/server/constants";
import type { apiFindOriginBranches } from "@dokploy/server/db/schema";
import { findOriginById, type Origin } from "@dokploy/server/services/origin";
import type { InferResultType } from "@dokploy/server/types/with";
import { TRPCError } from "@trpc/server";
import { quote } from "shell-quote";
import type { z } from "zod";

export const ORIGIN_API_BASE = "https://api.cursor.com/v1/origin";
export const ORIGIN_KEYS_URL = `${ORIGIN_API_BASE}/keys`;
export const ORIGIN_GIT_HOST = "origin.cursor.com";
export const ORIGIN_INSTALL_URL = "https://cursor.com/codebase/apps/install";
export const ORIGIN_APPS_SETTINGS_URL =
	"https://cursor.com/codebase/settings/apps";
export const ORIGIN_CLONE_USERNAME = "x-access-token";
export const ORIGIN_PUSH_EVENT = "repository.pushed";
export const ORIGIN_PING_EVENT = "ping";
export const ORIGIN_JWT_AUD = "origin-apps";
export const ORIGIN_RECEIPT_TYP = "origin-installation-receipt+jwt";
export const ORIGIN_INSTALL_SCOPES = "repository:contents:read";
export const ORIGIN_TOKEN_SCOPES = ["repository:contents:read"] as const;

const base64url = (value: Buffer | string) =>
	Buffer.from(value).toString("base64url");

const decodeJwtPart = (part: string) =>
	JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

export const generateOriginKeypair = () => {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	return {
		publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
		privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
	};
};

export const mintOriginAppJwt = (
	appId: string,
	privateKeyPem: string,
	lifetimeSeconds = 14 * 60,
) => {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "EdDSA", kid: appId, typ: "JWT" };
	const claims = {
		iss: appId,
		aud: ORIGIN_JWT_AUD,
		iat: now,
		exp: now + lifetimeSeconds,
	};
	const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
	const signature = sign(
		null,
		Buffer.from(signingInput),
		createPrivateKey(privateKeyPem),
	);
	return `${signingInput}.${base64url(signature)}`;
};

type OriginJson = Record<string, unknown>;

const originRequest = async <T = OriginJson>(
	path: string,
	token: string,
	init?: RequestInit,
): Promise<T> => {
	const response = await fetch(`${ORIGIN_API_BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			...(init?.body ? { "Content-Type": "application/json" } : {}),
			...init?.headers,
		},
	});
	const text = await response.text();
	if (!response.ok) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Origin API ${response.status}: request failed`,
		});
	}
	if (!text) {
		return {} as T;
	}
	return JSON.parse(text) as T;
};

export const haveOriginRequirements = (provider: Origin) => {
	return !!(
		provider.originAppId &&
		provider.originPrivateKey &&
		provider.originInstallationId
	);
};

export const getOriginInstallationToken = async (provider: Origin) => {
	if (!haveOriginRequirements(provider)) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Origin Account not configured correctly",
		});
	}

	const jwt = mintOriginAppJwt(
		provider.originAppId as string,
		provider.originPrivateKey as string,
	);
	const result = await originRequest<{ token?: string }>(
		`/app/installations/${provider.originInstallationId}/access_tokens`,
		jwt,
		{
			method: "POST",
			body: JSON.stringify({ scopes: [...ORIGIN_TOKEN_SCOPES] }),
		},
	);

	if (!result.token?.startsWith("oit_")) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Origin did not return an installation token",
		});
	}

	return result.token;
};

export type OriginRepository = {
	id: string;
	name: string;
	fullName?: string;
	owner: { slug: string; id?: string; type?: string };
	defaultBranch?: string;
	cloneUrl?: string;
};

export const getOriginRepositories = async (originId?: string) => {
	if (!originId) {
		return [] as OriginRepository[];
	}

	const provider = await findOriginById(originId);
	const token = await getOriginInstallationToken(provider);
	const repositories: OriginRepository[] = [];
	let pageToken = "";

	do {
		const query = pageToken
			? `?pageToken=${encodeURIComponent(pageToken)}&pageSize=100`
			: "?pageSize=100";
		const page = await originRequest<{
			repositories?: OriginRepository[];
			nextPageToken?: string;
		}>(`/installation/repos${query}`, token);
		repositories.push(...(page.repositories ?? []));
		pageToken = page.nextPageToken ?? "";
	} while (pageToken);

	return repositories;
};

export const getOriginBranches = async (
	input: z.infer<typeof apiFindOriginBranches>,
) => {
	if (!input.originId) {
		return [] as Array<{ name: string; commit?: { sha: string } }>;
	}

	const provider = await findOriginById(input.originId);
	const token = await getOriginInstallationToken(provider);
	const branches: Array<{ name: string; commit?: { sha: string } }> = [];
	let pageToken = "";

	do {
		const query = pageToken
			? `?pageToken=${encodeURIComponent(pageToken)}&pageSize=100`
			: "?pageSize=100";
		const page = await originRequest<{
			branches?: Array<{ name: string; commit?: { sha: string } }>;
			nextPageToken?: string;
		}>(
			`/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/branches${query}`,
			token,
		);
		branches.push(...(page.branches ?? []));
		pageToken = page.nextPageToken ?? "";
	} while (pageToken);

	return branches;
};

export const originCloneUrl = (owner: string, repository: string) =>
	`https://${ORIGIN_GIT_HOST}/${owner}/${repository}.git`;

export const originInstallUrl = (input: {
	appId: string;
	redirectUri: string;
	state: string;
}) => {
	const params = new URLSearchParams({
		client_id: input.appId,
		scope: ORIGIN_INSTALL_SCOPES,
		redirect_uri: input.redirectUri,
		state: input.state,
		summary: "Dokploy deploy access",
	});
	return `${ORIGIN_INSTALL_URL}?${params.toString()}`;
};

const getErrorCloneRequirements = (entity: {
	originRepository?: string | null;
	originOwner?: string | null;
	originBranch?: string | null;
}) => {
	const reasons: string[] = [];
	if (!entity.originRepository) reasons.push("1. Repository not assigned.");
	if (!entity.originOwner) reasons.push("2. Owner not specified.");
	if (!entity.originBranch) reasons.push("3. Branch not defined.");
	return reasons;
};

export type ApplicationWithOrigin = InferResultType<
	"applications",
	{ origin: true }
>;

export type ComposeWithOrigin = InferResultType<"compose", { origin: true }>;

interface CloneOriginRepository {
	appName: string;
	originOwner: string | null;
	originBranch: string | null;
	originId: string | null;
	originRepository: string | null;
	type?: "application" | "compose";
	enableSubmodules: boolean;
	serverId: string | null;
	outputPathOverride?: string;
}

export const cloneOriginRepository = async ({
	type = "application",
	...entity
}: CloneOriginRepository) => {
	let command = "set -e;";
	const isCompose = type === "compose";
	const {
		appName,
		originRepository,
		originOwner,
		originBranch,
		originId,
		enableSubmodules,
		serverId,
		outputPathOverride,
	} = entity;
	const { APPLICATIONS_PATH, COMPOSE_PATH } = paths(!!serverId);

	if (!originId) {
		command += `echo "Error: ❌ Origin Provider not found"; exit 1;`;
		return command;
	}

	const requirements = getErrorCloneRequirements(entity);
	if (requirements.length > 0) {
		command += `echo "Origin Repository configuration failed for application: ${appName}"; echo "Reasons:"; echo "${requirements.join("\n")}"; exit 1;`;
		return command;
	}

	const originProvider = await findOriginById(originId);
	const basePath = isCompose ? COMPOSE_PATH : APPLICATIONS_PATH;
	const outputPath = outputPathOverride ?? join(basePath, appName, "code");
	const token = await getOriginInstallationToken(originProvider);
	const publicClone = originCloneUrl(
		String(originOwner),
		String(originRepository),
	);
	const authenticatedClone = publicClone.replace(
		"https://",
		`https://${ORIGIN_CLONE_USERNAME}:${token}@`,
	);

	command += `rm -rf ${outputPath};`;
	command += `mkdir -p ${outputPath};`;
	command += `echo ${quote([`Cloning Repo ${ORIGIN_GIT_HOST}/${originOwner}/${originRepository}.git to ${outputPath}: ✅`])};`;
	command += `git clone --branch ${quote([String(originBranch ?? "")])} --depth 1 ${enableSubmodules ? "--recurse-submodules" : ""} ${quote([authenticatedClone])} ${quote([outputPath])} --progress;`;
	command += `git -C ${quote([outputPath])} remote set-url origin ${quote([publicClone])};`;

	return command;
};

export const fetchOriginSigningKeys = async (): Promise<JsonWebKey[]> => {
	const response = await fetch(ORIGIN_KEYS_URL);
	if (!response.ok) {
		throw new Error("Failed to fetch Origin signing keys");
	}
	const body = (await response.json()) as { keys?: JsonWebKey[] };
	return body.keys ?? [];
};

export const verifyOriginWebhookSignature = (
	body: Buffer,
	headers: Record<string, string | undefined>,
	keys: JsonWebKey[],
	nowSeconds = Math.floor(Date.now() / 1000),
): boolean => {
	const id = headers["webhook-id"];
	const timestamp = Number(headers["webhook-timestamp"]);
	const signature = headers["webhook-signature"]
		?.split(/\s+/)
		.find((value) => value.startsWith("v1ed,"));

	if (
		!id ||
		!signature ||
		!Number.isInteger(timestamp) ||
		Math.abs(nowSeconds - timestamp) > 300
	) {
		return false;
	}

	const digest = createHash("sha256")
		.update(`${id}.${timestamp}.`)
		.update(body)
		.digest("hex");

	return keys.some((jwk) => {
		try {
			return verify(
				null,
				Buffer.from(digest),
				createPublicKey({ key: jwk as never, format: "jwk" }),
				Buffer.from(signature.slice(5), "base64"),
			);
		} catch {
			return false;
		}
	});
};

export const verifyOriginInstallationReceipt = async (
	receipt: string,
	expected: { appId: string; state?: string },
	keys?: JsonWebKey[],
) => {
	const parts = receipt.split(".");
	if (parts.length !== 3) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid installation receipt",
		});
	}

	const [headerPart, payloadPart, signaturePart] = parts as [
		string,
		string,
		string,
	];
	const header = decodeJwtPart(headerPart) as {
		alg?: string;
		kid?: string;
		typ?: string;
	};
	const payload = decodeJwtPart(payloadPart) as {
		iss?: string;
		aud?: string;
		sub?: string;
		exp?: number;
		state?: string;
	};

	if (header.alg !== "EdDSA" || header.typ !== ORIGIN_RECEIPT_TYP) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid installation receipt",
		});
	}

	const jwks = keys ?? (await fetchOriginSigningKeys());
	const matching = header.kid
		? jwks.filter(
				(key) => (key as JsonWebKey & { kid?: string }).kid === header.kid,
			)
		: jwks;
	const signingInput = `${headerPart}.${payloadPart}`;
	const signature = Buffer.from(signaturePart, "base64url");
	const valid = matching.some((jwk) => {
		try {
			return verify(
				null,
				Buffer.from(signingInput),
				createPublicKey({ key: jwk as never, format: "jwk" }),
				signature,
			);
		} catch {
			return false;
		}
	});

	if (!valid) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid installation receipt",
		});
	}

	const now = Math.floor(Date.now() / 1000);
	if (
		payload.iss !== ORIGIN_API_BASE ||
		payload.aud !== expected.appId ||
		!payload.sub ||
		!payload.exp ||
		payload.exp < now
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid installation receipt",
		});
	}

	if (expected.state && payload.state !== expected.state) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid installation receipt",
		});
	}

	return payload;
};
