# Agent Instructions

- This repository is an open-source TypeScript + Nix project.
- Keep runtime code dependency-light; the Nix packages bundle TypeScript entrypoints with `esbuild`.
- Prefer adding small shared helpers in `packages/core` over duplicating routing, validation, signature, or branch naming logic.
- Do not add iOS simulator support until the project has an explicit nix-darwin design.
- For Android QA, skip with a clear diagnostic when `/dev/kvm` or an attached emulator is unavailable.
