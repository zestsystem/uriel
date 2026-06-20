# Security

Uriel assumes the worker can mutate code, run build commands, and access
repository credentials. Treat it like a privileged CI runner.

## Boundaries

- Public ingress terminates at Cloudflare.
- The control plane stores job metadata and artifact pointers.
- The NixOS worker owns code execution, mutable caches, and Git credentials.
- Worker dispatch is authenticated with `URIEL_WORKER_TOKEN`.
- User API calls are authenticated with `URIEL_API_TOKEN`.

## Webhook Verification

Implemented verification:

- GitHub: `X-Hub-Signature-256`
- Linear: `linear-signature`
- Slack: `X-Slack-Signature` + timestamp freshness
- Twilio: `X-Twilio-Signature`
- Discord: Ed25519 interaction signature

If a provider secret is not configured, the endpoint is allowed for local
development. Production deployments should configure every relevant secret.

## Secrets

Do not put provider secrets in `wrangler.jsonc`, Nix files, or the repository.
Use Wrangler secrets for the control plane and a NixOS secret mechanism for the
worker environment file.

## Repo Execution

The worker creates fresh worktrees from latest `origin/main` and never reuses
old worktrees for new jobs. This preserves target-repo worktree discipline and
keeps PRs tied to a single job.

## Approvals

The control plane includes approval endpoints, and the job model can represent
pending approval requests. v1 does not yet enforce a full policy engine around
dangerous commands; add policy gates before exposing Uriel to untrusted users.
