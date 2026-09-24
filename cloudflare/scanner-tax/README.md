# Scanner tax

A standalone Cloudflare Worker for `hacksnap.live`. Requests for environment
files, shell configuration, agent instructions, and WordPress admin/login/config
paths receive **HTTP 402 Payment Required**, a sarcastic invoice, and an ASCII
skeleton. Matching requests stop at the edge; all others use `fetch(request)` to
continue to the existing origin with their method, body, headers, and query intact.

## What it catches

- `.env` and variants such as `/backend/.env.production`.
- `.bashrc`, `.zshrc`, `.bash_profile`, and `.zprofile`, including nested paths.
- `AGENT.md`, `AGENTS.md`, `GEMINI.md`, and `QWEN.md`.
- `wp-admin`, `wp-login`, and `wp-config`, optionally ending in `.php`,
  including `/wp-admin/` and its children.

Matching ignores case, decodes URL escapes once, and collapses repeated slashes.
Malformed escapes fall back to the original path. This is a small set of probe
patterns, not a general path canonicalizer or replacement for origin access
controls. Query strings do not participate in matching or appear in the invoice.
The reflected path is capped at 200 characters and control characters are replaced.

All methods are checked. `HEAD` returns the same 402 and headers without a body.
Responses use plain text, `Cache-Control: no-store, max-age=0`,
`X-Robots-Tag: noindex, nofollow, noarchive`, and `X-Scanner-Tax: unpaid`.
There are no delays, external requests, or payment collection for blocked probes.

## Check locally

Use Node.js 22 or newer. From the repository root:

```sh
cd cloudflare/scanner-tax
npm ci
npm test
npm run check
```

Tests verify blocking without an origin request, encoded paths, ordinary site
paths, POST forwarding, HEAD responses, redirects, and safe reflected text.
`check` bundles the Worker with Wrangler without uploading or changing routes.

To preview the invoice:

```sh
npm run dev
# In another terminal:
curl -i http://localhost:8787/backend/.env
curl -I http://localhost:8787/wp-admin.php
```

The local preview is useful for blocked paths. Production passthrough depends on
Cloudflare's Route and origin DNS; localhost is not the site's origin.

## First deployment

1. Check `wrangler.jsonc`. It targets `hacksnap.live/*` in the `hacksnap.live`
   zone. The hostname must have a **proxied (orange-cloud)** Cloudflare DNS record
   pointing at the existing site. This uses a Worker **Route**, not a Worker
   Custom Domain. Confirm the route is not already assigned to another Worker.
2. Only if you also serve `www.hacksnap.live`, add a second route with pattern
   `www.hacksnap.live/*` and the same zone name. Other subdomains are not covered.
3. Authenticate and deploy from this directory:

   ```sh
   npx wrangler login
   npm run check
   npm run deploy
   ```

`workers.dev` and preview URLs are disabled. The Worker is intended to run in
front of the existing website.

## Deploy from GitHub

The `Deploy scanner-tax Worker` workflow runs tests and a Wrangler dry run on
matching pull requests and pushes to `main`. After successful checks, matching
pushes to `main` deploy automatically. It can also be run manually from Actions
on `main`; manual runs on other branches only run checks.

Before merging, add these repository Actions secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_WORKERS_API_TOKEN` | A dedicated Workers deployment API token |
| `CLOUDFLARE_WORKERS_ACCOUNT_ID` | The Cloudflare account ID owning `hacksnap.live` |

Create the token using Cloudflare's **Edit Cloudflare Workers** template and scope
it to the intended account and `hacksnap.live` zone. Deployment needs Workers
Scripts edit access for the account and Workers Routes edit access for the zone;
retain the template's read permissions for zone/account lookup. The account ID
value can be the same as the one used for the Spamhaus workflow.

The existing `CLOUDFLARE_API_TOKEN` is used for cache purges, and
`CLOUDFLARE_LISTS_API_TOKEN` is used for Spamhaus lists. Keep those separate.
The new workflow maps `CLOUDFLARE_WORKERS_API_TOKEN` and
`CLOUDFLARE_WORKERS_ACCOUNT_ID` to Wrangler's expected `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` environment variables only during deployment. Never commit
tokens. Both local and CI deployments use the Wrangler version in the lockfile.

## Verify after deployment

```sh
curl -i https://hacksnap.live/.bashrc
curl -i https://hacksnap.live/backend/.env
curl -i https://hacksnap.live/AGENT.md
curl -i https://hacksnap.live/wp-admin.php
curl --path-as-is -i 'https://hacksnap.live/.%65nv'
curl -I https://hacksnap.live/.env
curl -I https://hacksnap.live/
curl -I https://hacksnap.live/feed.xml
```

The first six should return 402 with `X-Scanner-Tax: unpaid`; HEAD has no body.
The homepage and feed should retain their normal responses. Cloudflare security
rules that block or challenge a request before the Worker may return their own
response instead of the invoice.

To stop interception, disable the GitHub deployment workflow and remove the
`hacksnap.live/*` route from the Worker's Domains & Routes settings. Keep the
existing DNS record. Update the committed routing config before re-enabling the
workflow, otherwise a later deploy will restore the route.

## References

- [Cloudflare Routes and proxied DNS requirements](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare API tokens for CI](https://developers.cloudflare.com/workers/ci-cd/external-cicd/)
