import { describe, expect, it } from "vitest";

import {
  buildBranchName,
  detectRepoProfile,
  repoCacheKey,
  validateCreateJobRequest
} from "../packages/core/src/index.ts";

describe("repo profiles", () => {
  it("defaults to the generic profile", () => {
    expect(detectRepoProfile("https://github.com/example/product.git")).toBe("generic");
  });

  it("can select a profile from caller-provided rules", () => {
    expect(
      detectRepoProfile("https://github.com/example/product.git", [
        { id: "acme/mobile", owner: "example", repo: "product" }
      ])
    ).toBe("acme/mobile");
  });
});

describe("branch naming", () => {
  it("uses generic issue keys when present", () => {
    expect(
      buildBranchName({
        issue: "APP-1234",
        prompt: "Fix event detail registration status",
        repo: "https://github.com/example/product.git"
      })
    ).toBe("codex/app-1234-fix-event-detail-registration-status");
  });

  it("creates stable repo cache keys", () => {
    expect(repoCacheKey("https://github.com/example/product.git")).toBe("example-product");
  });
});

describe("job validation", () => {
  it("accepts valid jobs", () => {
    const result = validateCreateJobRequest({
      prompt: "Build the thing",
      qa: "both",
      repo: "https://github.com/zestsystem/uriel.git"
    });
    expect(result.ok).toBe(true);
  });

  it("accepts adopter-defined job sources", () => {
    const result = validateCreateJobRequest({
      prompt: "Build the thing",
      repo: "https://github.com/zestsystem/uriel.git",
      source: "acme/chatops"
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source).toBe("acme/chatops");
    }
  });

  it("rejects non-GitHub repos", () => {
    const result = validateCreateJobRequest({
      prompt: "Build the thing",
      repo: "https://example.com/repo.git"
    });
    expect(result.ok).toBe(false);
  });
});
