# Deployment

## 1. Create Cloudflare Resources

Install dependencies and generate Worker binding types:

```bash
pnpm install
pnpm worker:types
```

Create R2 buckets:

```bash
pnpm exec wrangler r2 bucket create uriel-artifacts
pnpm exec wrangler r2 bucket create uriel-artifacts-staging
```

Set secrets:

```bash
pnpm exec wrangler secret put URIEL_API_TOKEN --cwd apps/control-plane
pnpm exec wrangler secret put URIEL_WORKER_TOKEN --cwd apps/control-plane
pnpm exec wrangler secret put GITHUB_WEBHOOK_SECRET --cwd apps/control-plane
pnpm exec wrangler secret put LINEAR_WEBHOOK_SECRET --cwd apps/control-plane
pnpm exec wrangler secret put SLACK_SIGNING_SECRET --cwd apps/control-plane
pnpm exec wrangler secret put DISCORD_PUBLIC_KEY --cwd apps/control-plane
pnpm exec wrangler secret put TWILIO_AUTH_TOKEN --cwd apps/control-plane
pnpm exec wrangler secret put URIEL_WORKER_DISPATCH_URL --cwd apps/control-plane
```

Deploy:

```bash
pnpm --dir apps/control-plane deploy
```

## 2. Expose The NixOS Worker

The recommended deployment is a private NixOS service exposed to the control
plane through Cloudflare Tunnel. The worker endpoint only needs:

- `GET /health`
- `POST /jobs`

The `POST /jobs` endpoint requires `Authorization: Bearer $URIEL_WORKER_TOKEN`
when the token is configured.

Example tunnel service:

```yaml
tunnel: uriel-worker
credentials-file: /var/lib/cloudflared/uriel-worker.json

ingress:
  - hostname: uriel-worker.example.com
    service: http://127.0.0.1:8788
  - service: http_status:404
```

Then set `URIEL_WORKER_DISPATCH_URL` in the Worker to
`https://uriel-worker.example.com`.

## 3. Install NixOS Module

```nix
{
  services.uriel-worker = {
    enable = true;
    controlPlaneUrl = "https://uriel-control-plane.example.workers.dev";
    workerTokenFile = "/run/secrets/uriel-worker.env";
  };
}
```

The token file is an environment file:

```bash
URIEL_WORKER_TOKEN=...
GH_TOKEN=...
URIEL_ADAPTER_LINEAR_API_KEY=...
```

## 4. Android Host Requirements

Use an x86_64 NixOS host with KVM available:

```bash
test -e /dev/kvm
ls -l /dev/kvm
```

The NixOS module adds the `uriel` user to `kvm`, `video`, `render`, and
`adbusers`. If no emulator is booted, Android QA records are skipped with a
diagnostic instead of failing the entire job.

## 5. Smoke Test

```bash
export URIEL_CONTROL_PLANE_URL=https://uriel-control-plane.example.workers.dev
export URIEL_API_TOKEN=...

nix run github:zestsystem/uriel#urielctl -- submit \
  --repo https://github.com/zestsystem/uriel.git \
  --prompt "Run a dry smoke test and report status" \
  --qa browser
```

## Optional Adapter Defaults

Worker defaults are configured through adapter names rather than organization
names:

```bash
URIEL_ADAPTER_ISSUE_TRACKER=linear
URIEL_ADAPTER_LINEAR_API_KEY=...
URIEL_ADAPTER_LINEAR_TEAM_KEY=APP
URIEL_ADAPTER_LINEAR_IN_PROGRESS_STATE="In Progress"
URIEL_ADAPTER_REPO_BOOTSTRAP=direnv
URIEL_ADAPTER_SECRETS_PROVIDER=doppler
```

Per-job metadata can override these defaults.
