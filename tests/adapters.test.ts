import { describe, expect, it } from "vitest";

import {
  adapterKey,
  AdapterRegistry,
  type RepoBootstrapAdapter
} from "../packages/core/src/index.ts";

describe("adapter registry", () => {
  const direnvAdapter: RepoBootstrapAdapter = {
    async bootstrap() {
      return undefined;
    },
    id: "direnv",
    kind: "repoBootstrap",
    summary: "Allow and load direnv environments."
  };

  it("registers and resolves adapters by kind and id", () => {
    const registry = new AdapterRegistry();

    registry.register(direnvAdapter);

    expect(registry.get("repoBootstrap", "direnv")).toBe(direnvAdapter);
    expect(registry.get("repoBootstrap", "missing")).toBeUndefined();
    expect(registry.list("repoBootstrap")).toEqual([direnvAdapter]);
  });

  it("rejects duplicate adapter registrations", () => {
    const registry = new AdapterRegistry();

    registry.register(direnvAdapter);

    expect(() => registry.register(direnvAdapter)).toThrow(
      "Adapter already registered: repoBootstrap:direnv"
    );
  });

  it("builds stable adapter keys", () => {
    expect(adapterKey("harness", "opencode")).toBe("harness:opencode");
  });
});
