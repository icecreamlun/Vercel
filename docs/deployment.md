# Deploy PromptShip

The public frontend runs on Vercel. The existing backend needs one continuously running container, PostgreSQL, and a Temporal service. Vercel Sandbox executes individual benchmark jobs; it does not host the API, database, or Temporal worker.

## Required resources

| Resource | Configuration |
| --- | --- |
| Vercel frontend | Repository root directory `web`, Node.js 22 or newer |
| Backend | Build the root `Dockerfile`; one always-on instance, port 8080, public HTTPS endpoint |
| PostgreSQL | Backend `DATABASE_URL`, using the provider's TLS settings |
| Temporal | `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, and `TEMPORAL_API_KEY` for Temporal Cloud |
| Runner archive | Persistent volume writable by container UID 1000; set `BUNDLE_DIR` to a directory on this volume |

The backend starts the API, dispatcher, and worker together. Do not enable scale-to-zero or multiple backend replicas for this version. Temporal Cloud hosts the Temporal service, but this application still runs its own worker.

## Configuration and deployment order

For Render, the root `render.yaml` defines the backend, a 1 GB runner archive disk, and a Basic 256 MB PostgreSQL instance with 1 GB of storage. It disables external database access and automatic deploys. Supply the `sync: false` environment variables when creating the Blueprint. The database connection is wired automatically. API-driven provisioning uses the same configuration.

1. Choose the frontend's stable production domain. Set backend `APP_ORIGIN` to that exact HTTPS origin without a trailing slash. Preview deployment URLs are not automatically accepted by the origin check.
2. Provision PostgreSQL and Temporal, then deploy the backend container with the variables below. The database schema is initialized on startup. Mount the runner archive before starting the container; preserve it across deployments.
3. Verify that the backend's `GET /health` returns HTTP 200. This checks database connectivity; a real evaluation is also needed to validate Temporal and Sandbox.
4. In the Vercel frontend project, set Root Directory to `web` and `API_URL` to the backend's public HTTPS origin. The checked-in `web/vercel.json` supplies the build settings. Rebuild after changing `API_URL`, because the rewrite destination is resolved during the build.
5. Deploy the frontend and use its stable production domain for the acceptance checks below.

Backend variables:

```dotenv
APP_ENV=production
APP_ORIGIN=https://YOUR_FRONTEND_DOMAIN
LISTEN_ADDR=0.0.0.0:8080
DATABASE_URL=YOUR_POSTGRES_CONNECTION_STRING
TEMPORAL_ADDRESS=YOUR_TEMPORAL_HOST:7233
TEMPORAL_NAMESPACE=YOUR_NAMESPACE
TEMPORAL_API_KEY=YOUR_TEMPORAL_KEY
BUNDLE_DIR=/data/bundles
VERCEL_TOKEN=YOUR_VERCEL_TOKEN
VERCEL_TEAM_ID=YOUR_TEAM_ID
VERCEL_PROJECT_ID=YOUR_SANDBOX_PROJECT_ID
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_KEY
```

Supply credentials through the backend host's secret manager. Deploy only `web` to the frontend; it needs `API_URL` and none of the model or Sandbox credentials. The Sandbox project may be separate from the frontend project. Do not upload `.token`, `.local`, or development databases.

## Public acceptance checks

- A new browser session creates an isolated workspace through the same-origin API proxy. Its session cookie has Secure, HttpOnly, and SameSite=Strict attributes.
- A real evaluation completes both sides and displays individual case results, with Sandbox executions cleaned up afterward.
- A blocked run cannot be promoted. An eligible run promotes and the Playground executes the new release.
- Another browser session cannot read or promote the first session's runs.
- Restart the backend during an evaluation and verify recovery of the existing remote command.

The budget counter is specific to the deployed database. Check its configured cap before sharing the URL; public visitors can consume the configured allowance through real model and Sandbox calls.

## Live deployment

The application is deployed and its public flow was validated on 2026-09-29 (UTC):

- Frontend: https://vercel-b2r2.vercel.app
- Backend: https://promptship-api.onrender.com
- Render service: `srv-datk43ugekts73b5bnpg`, Starter / 512 MB, one always-on instance.
- Render PostgreSQL: `dpg-datk1e2d0e5s73ce5v9g-a`, Basic 256 MB, 1 GB storage, external access disabled.
- Runner archive: 1 GB persistent disk at `/app/data`; `BUNDLE_DIR=/app/data/bundles`.
- Temporal Cloud: `quickstart-lizhuolun-02eaca83.stiyq`.
- Deployment source: private GitHub repository `icecreamlun/Vercel`, branch `codex/deploy-render-vercel`.

Render automatic deployments are disabled. The backend was built from commit `26b9416`; the final frontend from `6157b14`. Frontend configuration uses project root `web`, Node 22, and `API_URL=https://promptship-api.onrender.com`. Its production URL is publicly accessible. Other Vercel aliases are not accepted as mutation origins; use the canonical frontend URL above.

The backend includes the system CA trust bundle for verified TLS connections to Temporal Cloud. The initial slim image lacked this file; that startup failure was fixed without weakening certificate verification. The frontend also now handles non-JSON gateway errors and clears its connection error when polling recovers.

### Production validation

| Check | Result |
| --- | --- |
| Candidate A (`a6bae3f0e0147cefaf1d1b666f21f060`) | 16 results, blocked for the expired-order critical regression; promotion rejected with HTTP 409 |
| Candidate B (`ab9afbf4dd61ef6c8b75aba7981d6751`) | 16 results, candidate 8/8, gate passed |
| Worker restart during Candidate B | Existing Sandbox command retained; baseline lease advanced from 1 to 2 and the run completed |
| Five simultaneous promotions | Same release returned; generation advanced once, from 1 to 2 |
| Cross-session reads and promotion | Rejected with HTTP 404 |
| Published Playground, expired order | Denied, with no refund tool call |
| Published Playground, eligible order | Refunded, with exactly one refund tool call |
| Production cookies | Secure, HttpOnly, SameSite=Strict; API responses use `Cache-Control: no-store` |
| Temporary Sandbox cleanup | All executions from the four validation jobs cleaned up |
| Browser UI | Production page, evaluation dialog, prompt diff, recorded case evidence inspected |

Validation uses an isolated session, so a new visitor starts with a fresh baseline and sees the existing read-only examples. Model outputs remain nondeterministic; a passing validation run is not a guarantee that all future model calls will pass.

One backend instance with a persistent disk has a brief API interruption during restarts/deployments. Temporal recovers active evaluations, and the browser retries polling. This is an always-on deployment, not a high-availability deployment.

To run the acceptance scripts against the final frontend URL, use a dedicated cookie file so the local development session stays separate:

```sh
export SMOKE_API=https://YOUR_FRONTEND_DOMAIN
export SMOKE_ORIGIN=$SMOKE_API
export SMOKE_COOKIE=.local/production-smoke-cookie
node scripts/smoke.mjs candidate-b
node scripts/verify-flow.mjs
```

These commands perform real model calls and publish a passing result inside their isolated test session.
