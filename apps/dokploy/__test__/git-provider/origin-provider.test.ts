import {
	createHash,
	createPublicKey,
	generateKeyPairSync,
	sign,
	verify,
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const mockFindOriginById = vi.hoisted(() => vi.fn());

vi.mock("@dokploy/server/services/origin", () => ({
	findOriginById: mockFindOriginById,
}));

const {
	cloneOriginRepository,
	generateOriginKeypair,
	mintOriginAppJwt,
	ORIGIN_CLONE_USERNAME,
	ORIGIN_GIT_HOST,
	ORIGIN_JWT_AUD,
	ORIGIN_PUSH_EVENT,
	verifyOriginInstallationReceipt,
	verifyOriginWebhookSignature,
} = await import("@dokploy/server/utils/providers/origin");

describe("Origin Git provider", () => {
	it("generates an Ed25519 PEM keypair", () => {
		const keys = generateOriginKeypair();
		expect(keys.publicKey).toContain("BEGIN PUBLIC KEY");
		expect(keys.privateKey).toContain("BEGIN PRIVATE KEY");
	});

	it("mints an EdDSA app JWT with iss/kid = app id", () => {
		const keys = generateOriginKeypair();
		const jwt = mintOriginAppJwt("app_01test", keys.privateKey);
		const [headerB64, payloadB64, signatureB64] = jwt.split(".");
		if (!headerB64 || !payloadB64 || !signatureB64) {
			throw new Error("Expected a three-part JWT");
		}
		const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
		const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
		expect(header.alg).toBe("EdDSA");
		expect(header.kid).toBe("app_01test");
		expect(payload.iss).toBe("app_01test");
		expect(payload.aud).toBe(ORIGIN_JWT_AUD);
		const ok = verify(
			null,
			Buffer.from(`${headerB64}.${payloadB64}`),
			createPublicKey(keys.publicKey),
			Buffer.from(signatureB64, "base64url"),
		);
		expect(ok).toBe(true);
	});

	it("uses documented clone username x-access-token against origin.cursor.com", async () => {
		mockFindOriginById.mockResolvedValue({
			originId: "or-1",
			originAppId: "app_01test",
			originPrivateKey: generateOriginKeypair().privateKey,
			originInstallationId: "i_01test",
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				text: async () =>
					JSON.stringify({
						token: "oit_disposable_token",
						expiresAt: "2099-01-01T00:00:00Z",
					}),
			})),
		);

		const command = (
			await cloneOriginRepository({
				appName: "my-app",
				originOwner: "acme",
				originRepository: "web",
				originBranch: "main",
				originId: "or-1",
				enableSubmodules: false,
				serverId: null,
			})
		).replace(/\\/g, "");

		expect(ORIGIN_CLONE_USERNAME).toBe("x-access-token");
		expect(command).toContain(
			`https://${ORIGIN_CLONE_USERNAME}:oit_disposable_token@${ORIGIN_GIT_HOST}/acme/web.git`,
		);
		expect(command).toContain(`Cloning Repo ${ORIGIN_GIT_HOST}/acme/web.git`);
		expect(command).toContain("remote set-url origin");
		const echoLine = command
			.split(";")
			.find((part) => part.includes("Cloning Repo"));
		expect(echoLine).not.toContain("oit_");
		vi.unstubAllGlobals();
	});

	it("does not persist installation tokens on the provider row shape", () => {
		const provider = {
			originAppId: "app_01",
			originPrivateKey: "pem",
			originInstallationId: "i_01",
		};
		expect(JSON.stringify(provider)).not.toMatch(/oit_/);
	});
});

describe("Origin webhook signature", () => {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
	const now = 1_700_000_000;
	const body = Buffer.from(
		JSON.stringify({
			installationId: "i_01",
			event: { type: ORIGIN_PUSH_EVENT, payload: {} },
		}),
	);

	const signBody = (id: string, timestamp: number) => {
		const digest = createHash("sha256")
			.update(`${id}.${timestamp}.`)
			.update(body)
			.digest("hex");
		const signature = sign(null, Buffer.from(digest), privateKey).toString(
			"base64",
		);
		return `v1ed,${signature}`;
	};

	it("accepts a valid v1ed signature", () => {
		const id = "whd_01";
		expect(
			verifyOriginWebhookSignature(
				body,
				{
					"webhook-id": id,
					"webhook-timestamp": String(now),
					"webhook-signature": signBody(id, now),
				},
				[jwk],
				now,
			),
		).toBe(true);
	});

	it("rejects a missing or invalid signature", () => {
		expect(
			verifyOriginWebhookSignature(
				body,
				{
					"webhook-id": "whd_01",
					"webhook-timestamp": String(now),
					"webhook-signature": "v1ed,AAAA",
				},
				[jwk],
				now,
			),
		).toBe(false);
	});

	it("rejects timestamps older than five minutes", () => {
		const id = "whd_01";
		expect(
			verifyOriginWebhookSignature(
				body,
				{
					"webhook-id": id,
					"webhook-timestamp": String(now - 400),
					"webhook-signature": signBody(id, now - 400),
				},
				[jwk],
				now,
			),
		).toBe(false);
	});
});

describe("Origin installation receipt", () => {
	it("verifies EdDSA receipt claims", async () => {
		const { publicKey, privateKey } = generateKeyPairSync("ed25519");
		const jwk = {
			...publicKey.export({ format: "jwk" }),
			kid: "origin-key-id",
		} as JsonWebKey;
		const header = {
			alg: "EdDSA",
			kid: "origin-key-id",
			typ: "origin-installation-receipt+jwt",
		};
		const now = Math.floor(Date.now() / 1000);
		const payload = {
			iss: "https://api.cursor.com/v1/origin",
			aud: "app_01test",
			sub: "i_01install",
			exp: now + 120,
			state: "origin_setup:or-1:abc",
		};
		const signingInput = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
		const signature = sign(null, Buffer.from(signingInput), privateKey);
		const receipt = `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
		const claims = await verifyOriginInstallationReceipt(
			receipt,
			{ appId: "app_01test", state: "origin_setup:or-1:abc" },
			[jwk],
		);
		expect(claims.sub).toBe("i_01install");
	});
});
