# Uriel

Uriel is a NixOS-first remote coding and QA agent. It uses a small
Cloudflare control plane for public ingress, durable job state, webhook
handling, and artifact links, while a generic x86_64 NixOS worker does the
heavy work: Nix flake evaluation, repo worktrees, OpenCode, browser QA,
Android emulator QA, Git commits, and pull requests.

The first implementation is intentionally foundational. It gives you the
deployable skeleton, security boundaries, command surfaces, and tested core
behavior needed to grow a remote engineering agent framework without baking
any organization or repository assumptions into core.

## Architecture

- `apps/control-plane`: Cloudflare Worker + Durable Object job coordinator.
- `apps/worker`: NixOS-hosted worker daemon that receives jobs and runs them.
- `apps/cli`: `urielctl` CLI for submitting and managing jobs.
- `packages/core`: shared job schemas, branch naming, profile rule matching,
  and webhook signature helpers.
- `nix/modules`: NixOS and Home Manager modules.
- `examples`: copyable NixOS and Home Manager configurations.

Cloudflare stays small and durable. It accepts webhooks from Discord, Linear,
GitHub, Slack, and Twilio, then dispatches accepted jobs to a worker through a
Cloudflare Tunnel or any HTTPS endpoint protected by a shared worker token.
The NixOS worker owns mutable state under `/var/lib/uriel`.

## Status

Implemented v1 surfaces:

- `POST /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/events`
- `POST /api/jobs/:id/approve/:stepId`
- `POST /api/jobs/:id/cancel`
- `POST /api/jobs/:id/retry`
- `POST /api/jobs/:id/status`
- `POST /api/jobs/:id/events`
- `PUT /api/jobs/:id/artifacts/:name`
- `POST /webhooks/discord`
- `POST /webhooks/github`
- `POST /webhooks/linear`
- `POST /webhooks/slack`
- `POST /webhooks/twilio`
- `urielctl submit/status/approve/cancel`
- `uriel-worker serve/run`
- NixOS module `services.uriel-worker`
- Home Manager module `programs.uriel`

## Quick Start

```bash
pnpm install
pnpm check
pnpm worker:types
pnpm worker:dev
```

Submit a job to a deployed control plane:

```bash
export URIEL_CONTROL_PLANE_URL=https://uriel.example.workers.dev
export URIEL_API_TOKEN=...

pnpm exec tsx apps/cli/src/main.ts submit \
  --repo https://github.com/acme/mobile-app.git \
  --prompt "Fix the failing mobile registration test" \
  --issue APP-1234 \
  --issue-tracker linear \
  --qa both
```

Run a worker locally:

```bash
export URIEL_WORKER_TOKEN=...
export URIEL_CONTROL_PLANE_URL=http://localhost:8787
pnpm exec tsx apps/worker/src/main.ts serve --host 127.0.0.1 --port 8788
```

## NixOS Worker

The worker is designed for a generic x86_64 NixOS host with KVM enabled.
Android QA is skipped with a diagnostic if `/dev/kvm` or an attached emulator
is unavailable.

```nix
{
  inputs.uriel.url = "github:zestsystem/uriel";

  outputs = { self, nixpkgs, uriel, ... }: {
    nixosConfigurations.worker = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        uriel.nixosModules.uriel-worker
        ./hardware-configuration.nix
        {
          services.uriel-worker = {
            enable = true;
            controlPlaneUrl = "https://uriel.example.workers.dev";
            environmentFiles = [ "/run/secrets/uriel-worker.env" ];
          };
        }
      ];
    };
  };
}
```

## Secrets

Use Wrangler secrets for Cloudflare runtime secrets:

```bash
wrangler secret put URIEL_API_TOKEN
wrangler secret put URIEL_WORKER_TOKEN
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put LINEAR_WEBHOOK_SECRET
wrangler secret put SLACK_SIGNING_SECRET
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put TWILIO_AUTH_TOKEN
```

The NixOS worker reads these environment variables when needed:

- `URIEL_WORKER_TOKEN`
- `URIEL_CONTROL_PLANE_URL`
- `GH_TOKEN`
- `OPENCODE_MODEL`
- `URIEL_ADAPTER_ISSUE_TRACKER`
- `URIEL_ADAPTER_LINEAR_API_KEY`
- `URIEL_ADAPTER_LINEAR_TEAM_KEY`
- `URIEL_ADAPTER_LINEAR_IN_PROGRESS_STATE`
- `URIEL_ADAPTER_REPO_BOOTSTRAP`
- `URIEL_BROWSER_URL`
- `URIEL_ANDROID_AVD`

On NixOS, prefer supplying those values through `services.uriel-worker.environmentFiles`.
Those files can be produced by Nix-native secret tools such as `sops-nix`,
`agenix`, or any other mechanism that writes root-readable environment files
outside the Nix store.

## Profiles And Adapters

Uriel core treats `profile` as an opaque string. A profile is an adopter-owned
bundle of adapters, not a hardcoded repository identity.

Adapter dimensions:

- Issue tracker: optional, currently `linear`
- Repo bootstrap: optional, currently `direnv`
- QA capability: `browser`, `android`, or both
- Artifact storage: control-plane R2 by default
- Webhook source: API, Discord, GitHub, Linear, Slack, or Twilio

Adapters can be selected per job through metadata:

```bash
urielctl submit \
  --repo https://github.com/acme/mobile-app.git \
  --prompt "Fix checkout crash" \
  --issue APP-1234 \
  --profile acme/mobile \
  --issue-tracker linear \
  --repo-bootstrap direnv
```

They can also be configured as worker defaults with
`URIEL_ADAPTER_ISSUE_TRACKER` and `URIEL_ADAPTER_REPO_BOOTSTRAP`.

## License

Apache-2.0.
