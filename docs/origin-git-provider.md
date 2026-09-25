# Origin Git provider (self-hosted)

Connect Cursor Origin as a Git source. Each Dokploy instance registers its own Origin App (Ed25519 keypair + app id). Users install that App into an Origin codebase. There is no marketplace App and no Dokploy Cloud OAuth.

The Dokploy host must be reachable over **public HTTPS** for the install callback and webhooks (same constraint as the GitHub App provider). Use a reverse proxy or tunnel in development.

## 1. Generate a keypair

In **Settings → Git Providers → Origin**, click **Generate Ed25519 keypair**, or create one locally:

```bash
openssl genpkey -algorithm ED25519 -out origin-app-private.pem
openssl pkey -in origin-app-private.pem -pubout -out origin-app-public.pem
```

Keep the private key secret. Register only the public key with Origin.

## 2. Create the Origin App

Open [cursor.com/codebase/settings/apps](https://cursor.com/codebase/settings/apps) and create an App with:

- Public key (PEM `BEGIN PUBLIC KEY`)
- Installation callback URL: `https://YOUR_DOKPLOY_HOST/api/providers/origin/callback`
- Webhook URL: `https://YOUR_DOKPLOY_HOST/api/deploy/origin`
- Event: `repository.pushed`

Copy the Origin App ID (`app_…`).

## 3. Paste credentials into Dokploy

Save the provider with the App ID and private key. The private key is encrypted at rest.

## 4. Install

Open the provider and click **Install**. Origin redirects back with a signed installation receipt. Dokploy stores the installation id only (never an `oit_` token).

## 5. Deploy

On an application or compose service, choose **Origin**, pick a repository and branch, then deploy. Auto-deploy listens for Origin `repository.pushed` webhooks (Ed25519 `webhook-signature`, not GitHub HMAC).

Clone uses Git HTTPS with username `x-access-token` and a short-lived installation token minted immediately before clone (≤15 minutes). Tokens are not stored.

## Out of scope

PR preview environments, check-run comments, SSH/deploy keys, marketplace Apps, and installation repair UI.
