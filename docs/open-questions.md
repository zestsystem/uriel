# Open Questions

These are intentionally left out of v1 implementation decisions.

- Whether Hermes should become a first-class messaging gateway or remain an
  optional sidecar.
- Whether Cloudflare Think should own conversation memory around jobs once the
  core worker is stable.
- Whether to provision opinionated AWS or Hetzner infrastructure modules.
- How much PR evidence should be mirrored into GitHub comments versus kept in
  the control plane.
- Whether Android emulator images should be prebuilt into a host image or
  managed through a worker bootstrap command.
- What adapter registry format should be used for larger organizations:
  environment variables, checked-in profile files, a remote registry, or all
  three.
