# Deploying the career-ops web app (Coolify / Docker)

The app is **local-first by design**. Deploying it to a server is supported by
the files in this repo, but it changes one assumption the code was built on, and
that change is the most important thing on this page.

## Read this first: two deployment modes, two different risk models

career-ops runs in one of two modes, chosen by whether `CAREER_OPS_ENCRYPTION_KEY`
is set (see "Optional: multi-tenant accounts" below). Both need the **origin
guard** (`src/lib/origin-guard.mjs`, wired through `src/proxy.ts` over every
`/api/*` route), which independently of accounts answers only:

- requests whose `Host` is loopback, **or** a host you explicitly opt in via
  `CAREER_OPS_WEB_ALLOWED_HOSTS`; and
- requests that are same-origin (`Sec-Fetch-Site`), so a random page you visit
  cannot POST to the app in the background.

Setting `CAREER_OPS_WEB_ALLOWED_HOSTS=careerops.example.com` is *required* for
either mode — without it the browser's own API calls 403 and the app looks
broken.

**Single-tenant mode (`CAREER_OPS_ENCRYPTION_KEY` unset) — no accounts, no login.**
The origin guard stops cross-origin abuse and drive-by CSRF, but anyone who
reaches the URL at all reads and writes the one shared `cv.md`/tracker/reports
with no login screen in the way — `/api/pipeline` reads your data, `/api/run`
spawns an agent CLI with your API key (anyone with the URL can spend your
tokens), `/api/status`/`/api/cv`/`/api/profile` write to your files. **Put
authentication in front of the app** for this mode:

| Option | Notes |
|---|---|
| Cloudflare Access | Best fit if the domain is already on Cloudflare. Identity before the request reaches Coolify. |
| Coolify Basic Auth | Simplest. Set it on the resource in Coolify's UI. |
| Tailscale / WireGuard | Strongest: the app is never on the public internet at all. |

**Multi-tenant mode (`CAREER_OPS_ENCRYPTION_KEY` set) — real accounts + per-user isolation.**
`/signup` and `/login` gate every route (`withTenantHandler` — see
DATA_CONTRACT.md's `tenants/{userId}/` row): each signed-up user reads and
writes only their own `tenants/{userId}/` tree, brings their own provider API
key (encrypted at rest, never another user's to spend), and a request with no
valid session falls through to the single-tenant shared root above, not to
another user's data. This is the real multi-user auth the single-tenant
section above says doesn't exist — it does now, for this mode.

A front-door proxy gate (the same three options above) is no longer required
to prevent one signed-up user from reading another's data — that's what
accounts + isolation now do. **Recommended default: keep one anyway**, gating
who is allowed to reach `/signup` at all (invite-only) rather than leaving it
open to the public internet — an operational choice about who gets an
account, not a data-isolation gap, and the safer starting posture for a
deployment this new. Open public signup is a reasonable later choice once
you're confident in the accounts+isolation layer and want it to behave like a
self-serve product. Two things this mode does **not** yet cover, regardless of
a front-door gate — see their own sections below for the full detail:
background workers (scan/batch-eval/liveness) still run against the single
shared/default root, not per-tenant, and no per-tenant request-body-size
ceiling exists app-wide (a signed-up user could still send an oversized
request to a route with no explicit limit of its own).

## What the deployment gives you

Working: Today and the decision queue, Explore, Pipeline, the role/report views,
Analytics, CV editing, Settings, and the whole PWA layer — installable to a
phone home screen, offline reads, and the queued-write replay.

Working when `ANTHROPIC_API_KEY` is set: evaluations, CV tailoring, PDF
rendering (Chromium ships in the image), and the agent console.

Not working: the LaTeX CV path (`latex` mode). TeX Live is ~2GB and is left out
of the image deliberately; use the HTML/PDF path, or add
`texlive-latex-recommended texlive-latex-extra texlive-xetex latexmk` to the
runtime stage's `apt-get install` if you need it.

## Coolify setup

1. **New Resource → Docker Compose**, pointed at this repo and branch.
2. **Compose file:** `docker-compose.coolify.yml`.
   *Not* `docker-compose.yml` — that one is the developer sandbox: it
   bind-mounts sources and runs `tail -f /dev/null`, so it serves nothing.
3. **Environment variables:**

   | Variable | Required | Value |
   |---|---|---|
   | `CAREER_OPS_WEB_ALLOWED_HOSTS` | **yes** | your domain, e.g. `careerops.example.com` |
   | `SERVICE_FQDN_WEB_3000` | yes | the same domain — Coolify routes and issues TLS from it |
   | `ANTHROPIC_API_KEY` | for AI features | your key |
   | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` | no | the repo's alternative eval paths |
   | `CAREER_OPS_ENCRYPTION_KEY` | for multi-tenant mode | see "Optional: multi-tenant accounts" below — omit for single-tenant |

4. **Enable Basic Auth** on the resource (or put Cloudflare Access in front)
   either way. In single-tenant mode this is required — see "Read this first"
   above. In multi-tenant mode it's no longer needed to protect one user's
   data from another (accounts already do that), but it's the recommended
   default anyway: it makes `/signup` invite-only rather than open to the
   public internet, the safer starting posture for a deployment this new.
   Drop it later once you're confident in the accounts+isolation layer and
   want open public signup.
5. Deploy. The first build takes a while — it installs Chromium.

Health is reported on `GET /api/version`; the container's own healthcheck polls
it over loopback, which the guard always allows.

## How state persists

career-ops keeps state in **files**: `data/applications.md` is the tracker,
`reports/` holds the evaluations, `cv.md` is the CV. There is no database.

The container therefore splits the career-ops root in two:

```
/opt/career-ops    the image's copy — CODE, replaced on every deploy
/app               a named volume  — the live root the app reads and writes
```

`docker-entrypoint.sh` reconciles them on every boot, along the same line
`DATA_CONTRACT.md` draws:

- **System layer** (`modes/`, `templates/`, `lib/`, root `*.mjs`, …) is
  overwritten from the image, so deploying a new image actually updates the
  code. `node_modules` is symlinked rather than copied — 21MB the app never
  writes.
- **User layer** (`data/`, `reports/`, `output/`, `config/`, `cv.md`,
  `interview-prep/`, `documents/`, `jds/`) is created if absent and then never
  touched. This is the half that survives a redeploy.

`modes/` is the awkward case and is handled specially: system modes live beside
the user-layer `_profile.md` and `_custom.md`, so the entrypoint copies the
directory's *contents* without deleting, rather than replacing the directory and
taking the user's targeting with it.

Files are copied, not symlinked, on purpose: every user-layer write goes through
`atomicWrite()`, which writes a temp file and renames it over the target. A
rename **replaces a symlink with a regular file**, so a symlinked `cv.md` would
silently stop persisting the first time the CV was saved.

**Back up the `career-ops-root` volume.** It holds everything, it is the only
copy, and none of it is in git (the user layer is gitignored by design).

Do not run `update-system.mjs apply` in the container — it rewrites `/app`'s
system files, which the entrypoint overwrites from the image on the next boot.
Deploy a new image instead.

## First run

The app detects an empty setup and walks you through it: paste or upload a CV,
fill in `config/profile.yml`, then the scanner. `portals.yml` is seeded from the
example so Explore works immediately. `cv.md` and `config/profile.yml` are
deliberately **not** seeded — an empty placeholder reads as "done" and would skip
you past onboarding.

## Building outside Coolify

```bash
# Context is the repo ROOT, not web/.
docker build -f web/Dockerfile -t career-ops-web .

docker run -d --name career-ops-web \
  -p 3000:3000 \
  --shm-size=1g \
  -e CAREER_OPS_WEB_ALLOWED_HOSTS=careerops.example.com \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v career-ops-root:/app \
  career-ops-web
```

For a purely local run, omit `CAREER_OPS_WEB_ALLOWED_HOSTS` and reach it on
`http://localhost:3000` — loopback is allowed by default, which is the
configuration the security model was actually designed for.

## Using a different agent CLI

The image installs `@anthropic-ai/claude-code`, and `src/lib/clis.ts` finds any
supported CLI by walking `PATH`. To swap or add one, edit that `npm install -g`
line in the runtime stage of `web/Dockerfile`. Supported ids: `claude`, `codex`,
`gemini`, `opencode`, `copilot`, `qwen`, `antigravity`, `grok`.

## Optional: multi-tenant accounts (signup/login, per-user API keys)

By default this deployment is the single-tenant model described at the top of
this doc: one shared `cv.md`/tracker, no login. Setting
`CAREER_OPS_ENCRYPTION_KEY` turns on `/signup` and `/login` (backed by
`_accounts.db`, a SQLite file at the volume root — see DATA_CONTRACT.md) and a
"Your API key" section on `/config` where a signed-in user stores their own
provider key, encrypted at rest:

```bash
CAREER_OPS_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

Generate it once and keep it — rotating it makes every already-stored API key
undecryptable (the same tradeoff as the VAPID keypair above).

Signing up now DOES give a user their own isolated `cv.md`/tracker/reports —
every request from a signed-in user runs against `tenants/{userId}/` under the
volume root (seeded from the same system-layer files the default `/app` root
gets at boot), while requests with no valid session keep reading/writing the
original single-tenant shared root exactly as before this feature existed.
This is enforced ambiently (`AsyncLocalStorage`), not per-route, so it covers
every route that touches career-ops data — including CLI child processes
spawned on a request's behalf, which inherit the same resolved root and the
signed-in user's own decrypted API key as environment variables.

**Known gap — background workers are not yet per-tenant.** The scan/batch-eval/
liveness workers (`/api/workers`, `src/lib/workers/scheduler.ts`) run on a
process-wide timer outside any request's `AsyncLocalStorage` context, so they
always operate against the single shared/default root regardless of how many
tenants have signed up. A multi-tenant deployment should treat automatic
background scanning as a single-tenant-only feature until this is addressed;
each tenant can still trigger their own on-demand work through the normal
request-scoped routes, which are fully isolated.

Each tenant can also keep more than one named base CV (the CV editor's
"+ New CV" switcher) — e.g. a "Backend" and an "AI/ML" CV — and switch which
one is active. This is layered on top of `cv.md`, not a replacement for it:
whichever CV is active is kept mirrored into `cv.md`, so every mode, script
and report that reads `cv.md` directly keeps working completely unmodified.
See `web/src/lib/cv-library.mjs` and DATA_CONTRACT.md's `cvs/` row.

**Security pass (Phase 4).** Both throttles below live in `_accounts.db`
(`web/src/lib/auth/db.mjs`), not an in-process `Map` — a deploy/restart no
longer resets an attacker's progress toward the limit:

- **Login**: per-email exponential backoff on failed attempts (unchanged
  behavior from Phase 1, moved to persist across restarts).
- **Signup**: NEW — up to 8 signups per hour per source IP
  (`X-Forwarded-For`/`X-Real-IP`, best-effort; see `client-ip.mjs`). Phase 1-3
  had no signup limit at all, and an unthrottled signup both writes an
  accounts row and provisions a full tenant directory on first use — a
  scriptable way to fill the volume's disk. This throttle is a soft limit
  behind a raw (non-proxied) deployment where a client's own header is the
  only signal; behind Coolify/Traefik (this app's documented target) the
  proxy's own hop makes it a real one.

Everything else in `origin-guard.mjs` (same-origin/loopback enforcement) and
`crypto.mjs` (scrypt, AES-256-GCM with auth-tag verification, 256-bit session
tokens, a required non-default encryption key) was already in place from
Phase 1 and reviewed again here without changes needed.

**Not addressed in this pass, and not specific to multi-tenancy:** no
app-wide request body size cap exists yet (a signed-in tenant could still
send an oversized JSON body to a route without its own explicit ceiling — the
CV routes cap at 200KB, `settings/api-key` at 2000 chars, but this isn't
enforced globally). Worth a follow-up if this deployment is ever opened to
untrusted signups at scale.

## Optional: linking your LinkedIn on the /about page

The `/about` credits page pulls real, public GitHub profile data automatically.
It omits the LinkedIn row unless you set one explicitly — nothing here
fabricates a link:

```bash
NEXT_PUBLIC_CREDITS_LINKEDIN_URL=https://linkedin.com/in/yourhandle
```

See [Credits & this deployment](README.md#credits--this-deployment) above for
who built this deployment layer and the terms that apply to it.
