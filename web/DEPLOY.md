# Deploying the career-ops web app (Coolify / Docker)

The app is **local-first by design**. Deploying it to a server is supported by
the files in this repo, but it changes one assumption the code was built on, and
that change is the most important thing on this page.

## Read this first: there is no login

career-ops has no user accounts and no authentication. What it has is an
**origin guard** (`src/lib/origin-guard.mjs`, wired through `src/proxy.ts` over
every `/api/*` route) that answers only:

- requests whose `Host` is loopback, **or** a host you explicitly opt in via
  `CAREER_OPS_WEB_ALLOWED_HOSTS`; and
- requests that are same-origin (`Sec-Fetch-Site`), so a random page you visit
  cannot POST to the app in the background.

Setting `CAREER_OPS_WEB_ALLOWED_HOSTS=careerops.example.com` is *required* for a
deployment — without it the browser's own API calls 403 and the app looks
broken. But it is also precisely the step that removes the loopback protection
for that host. After it, the guard stops cross-origin abuse and nothing else.

**So put authentication in front of the app.** Any of these is enough:

| Option | Notes |
|---|---|
| Cloudflare Access | Best fit if the domain is already on Cloudflare. Identity before the request reaches Coolify. |
| Coolify Basic Auth | Simplest. Set it on the resource in Coolify's UI. |
| Tailscale / WireGuard | Strongest: the app is never on the public internet at all. |

Deployed without one of those, the URL is the only thing standing between the
internet and:

- **your CV, tracker and evaluation reports** — readable over `/api/pipeline`;
- **`/api/run`** — spawns an agent CLI with your API key, i.e. anyone with the
  URL can spend your tokens;
- **`/api/status`, `/api/cv`, `/api/profile`** — write to your files.

This is not a bug in the guard. It is what "local-first, no accounts" means once
the app is not on localhost. Real multi-user auth needs the gate store from
`HANDOFF.md` §5 and per-user data isolation, neither of which exists yet.

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

4. **Enable Basic Auth** on the resource (or put Cloudflare Access in front).
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

## Optional: linking your LinkedIn on the /about page

The `/about` credits page pulls real, public GitHub profile data automatically.
It omits the LinkedIn row unless you set one explicitly — nothing here
fabricates a link:

```bash
NEXT_PUBLIC_CREDITS_LINKEDIN_URL=https://linkedin.com/in/yourhandle
```

See [Credits & this deployment](README.md#credits--this-deployment) above for
who built this deployment layer and the terms that apply to it.
