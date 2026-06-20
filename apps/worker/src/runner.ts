import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  repoCacheKey,
  type Job,
  worktreeSlug
} from "../../../packages/core/src/index.ts";
import type { WorkerConfig } from "./config.ts";
import { ensureLinearIssue } from "./linear.ts";
import { runQa } from "./qa.ts";
import { JobReporter } from "./reporter.ts";
import { commandExists, exists, runChecked, runCommand } from "./shell.ts";

export async function runJob(job: Job, config: WorkerConfig): Promise<void> {
  const reporter = new JobReporter({
    controlPlaneUrl: config.controlPlaneUrl,
    jobId: job.id,
    token: config.workerToken
  });
  const artifactsDir = join(config.artifactsDir, job.id);

  try {
    await mkdir(artifactsDir, { recursive: true });
    await reporter.status("running");
    await reporter.event("job", "info", `Starting job ${job.id}.`);

    const worktree = await prepareWorktree(job, config, reporter);
    await inspectRepository(worktree, artifactsDir, reporter);
    await runProfileSetup(job, config, worktree, reporter);
    await runOpenCode(job, config, worktree, artifactsDir, reporter);
    await runQa(job, config, artifactsDir, reporter);
    await finalizePullRequest(job, worktree, artifactsDir, reporter);

    await reporter.status("completed");
    await reporter.event("job", "info", "Job completed.");
  } catch (error) {
    await reporter.status("failed");
    await reporter.event("job", "error", errorMessage(error));
    throw error;
  }
}

async function prepareWorktree(
  job: Job,
  config: WorkerConfig,
  reporter: JobReporter
): Promise<string> {
  await mkdir(config.reposDir, { recursive: true });
  await mkdir(config.worktreesDir, { recursive: true });

  const cacheDir = join(config.reposDir, repoCacheKey(job.repo));
  const worktree = join(
    config.worktreesDir,
    `${job.id}-${worktreeSlug(job.branch)}`
  );
  if (await exists(worktree)) {
    await rm(worktree, { force: true, recursive: true });
  }

  if (await exists(cacheDir)) {
    await reporter.event("repo", "info", "Fetching latest origin/main.", {
      cacheDir
    });
    await runChecked("git", ["-C", cacheDir, "fetch", "origin", "main", "--prune"], {
      timeoutMs: 120_000
    });
  } else {
    await reporter.event("repo", "info", "Cloning bare repository cache.", {
      repo: job.repo,
      cacheDir
    });
    await runChecked("git", ["clone", "--bare", job.repo, cacheDir], {
      timeoutMs: 300_000
    });
  }

  await reporter.event("repo", "info", `Creating worktree ${job.branch}.`, {
    worktree
  });
  await runChecked(
    "git",
    ["-C", cacheDir, "worktree", "add", "-B", job.branch, worktree, "origin/main"],
    { timeoutMs: 120_000 }
  );
  return worktree;
}

async function inspectRepository(
  worktree: string,
  artifactsDir: string,
  reporter: JobReporter
): Promise<void> {
  const agentInstructions = join(worktree, "AGENTS.md");
  if (await exists(agentInstructions)) {
    const content = await readFile(agentInstructions, "utf8");
    await writeFile(join(artifactsDir, "AGENTS.md"), content);
    await reporter.uploadArtifact("AGENTS.md", content, "text/markdown");
    await reporter.event("repo", "info", "Loaded AGENTS.md instructions.");
  }

  if (await exists(join(worktree, "flake.nix"))) {
    await reporter.event("repo", "info", "Evaluating Nix flake outputs.");
    const result = await runCommand(
      "nix",
      ["flake", "show", "--json", "--no-write-lock-file"],
      { cwd: worktree, timeoutMs: 180_000 }
    );
    await writeFile(
      join(artifactsDir, "nix-flake-show.json"),
      result.stdout || result.stderr
    );
    await reporter.uploadArtifact(
      "nix-flake-show.json",
      result.stdout || result.stderr,
      "application/json"
    );
    if (result.code !== 0) {
      await reporter.event("repo", "warn", "nix flake show failed.", {
        stderr: result.stderr.slice(-4000)
      });
    }
  }

  if (await exists(join(worktree, "justfile")) || await exists(join(worktree, "Justfile"))) {
    const result = await runCommand("just", ["--list"], {
      cwd: worktree,
      timeoutMs: 60_000
    });
    await writeFile(join(artifactsDir, "just-list.txt"), result.stdout + result.stderr);
    await reporter.uploadArtifact("just-list.txt", result.stdout + result.stderr, "text/plain");
  }
}

async function runProfileSetup(
  job: Job,
  config: WorkerConfig,
  worktree: string,
  reporter: JobReporter
): Promise<void> {
  const issueTracker = metadataString(job, "issueTracker") ?? config.issueTrackerAdapter;
  const repoBootstrap = metadataString(job, "repoBootstrap") ?? config.repoBootstrapAdapter;
  const secretsProvider =
    metadataString(job, "secretsProvider") ?? config.secretsProviderAdapter;

  if (issueTracker === "linear") {
    const issue = await ensureLinearIssue(job, {
      apiKey: config.linearApiKey,
      inProgressState: config.linearInProgressState,
      teamKey: config.linearTeamKey
    });
    if (issue) {
      await reporter.event("repo", "info", `Using Linear issue ${issue}.`);
    } else {
      await reporter.event(
        "repo",
        "warn",
        "Linear issue adapter is enabled but no issue was available or created; configure URIEL_ADAPTER_LINEAR_API_KEY and URIEL_ADAPTER_LINEAR_TEAM_KEY to allow creation."
      );
    }
  }

  if (repoBootstrap === "direnv" || secretsProvider === "doppler") {
    if (await commandExists("direnv")) {
      await reporter.event("repo", "info", "Allowing direnv for repository bootstrap.");
      await runCommand("direnv", ["allow"], { cwd: worktree, timeoutMs: 60_000 });
    } else {
      await reporter.event("repo", "warn", "direnv is missing; skipping direnv bootstrap.");
    }
  }

  if (secretsProvider === "doppler") {
    if (await commandExists("direnv")) {
      await reporter.event("repo", "info", "Running Doppler secrets adapter setup.");
      const result = await runCommand(
        "direnv",
        ["exec", ".", "doppler", "setup", "--no-interactive"],
        { cwd: worktree, timeoutMs: 120_000 }
      );
      if (result.code !== 0) {
        await reporter.event("repo", "warn", "Doppler secrets adapter setup failed.", {
          stderr: result.stderr.slice(-4000)
        });
      }
    } else {
      await reporter.event("repo", "warn", "direnv is missing; skipping Doppler setup.");
    }
  }
}

async function runOpenCode(
  job: Job,
  config: WorkerConfig,
  worktree: string,
  artifactsDir: string,
  reporter: JobReporter
): Promise<void> {
  const transcriptPath = join(artifactsDir, "opencode-transcript.jsonl");

  if (config.dryRun || !(await commandExists("opencode"))) {
    const message = config.dryRun
      ? "URIEL_DRY_RUN enabled; skipping OpenCode execution."
      : "opencode is missing; writing a dry-run transcript.";
    await reporter.event("worker", "warn", message);
    await writeFile(transcriptPath, JSON.stringify({ message, prompt: job.prompt }) + "\n");
    await reporter.uploadArtifact(
      "opencode-transcript.jsonl",
      await readFile(transcriptPath),
      "application/x-ndjson"
    );
    return;
  }

  await reporter.event("worker", "info", "Running OpenCode headlessly.");
  const args = [
    "run",
    "--format",
    "json",
    "--title",
    job.branch,
    "--dir",
    worktree,
    ...(config.opencodeModel ? ["--model", config.opencodeModel] : []),
    buildPrompt(job)
  ];
  const result = await runCommand("opencode", args, {
    cwd: worktree,
    timeoutMs: 45 * 60_000
  });
  await writeFile(transcriptPath, result.stdout + result.stderr);
  await reporter.uploadArtifact(
    "opencode-transcript.jsonl",
    await readFile(transcriptPath),
    "application/x-ndjson"
  );
  if (result.code !== 0) {
    throw new Error(`OpenCode failed with ${result.code}.`);
  }
}

async function finalizePullRequest(
  job: Job,
  worktree: string,
  artifactsDir: string,
  reporter: JobReporter
): Promise<void> {
  const status = await runChecked("git", ["status", "--porcelain"], {
    cwd: worktree
  });
  if (!status.stdout.trim()) {
    await reporter.event("repo", "warn", "No file changes were produced.");
    return;
  }

  await runChecked("git", ["add", "-A"], { cwd: worktree });
  await runChecked(
    "git",
    ["commit", "-m", summarizeCommit(job.prompt)],
    { cwd: worktree, timeoutMs: 120_000 }
  );
  await runChecked("git", ["push", "-u", "origin", job.branch], {
    cwd: worktree,
    timeoutMs: 300_000
  });

  if (!(await commandExists("gh"))) {
    await reporter.event("repo", "warn", "gh is missing; branch pushed but PR was not created.");
    return;
  }

  const prBody = buildPullRequestBody(job);
  const bodyPath = join(artifactsDir, "pull-request-body.md");
  await writeFile(bodyPath, prBody);
  const pr = await runCommand(
    "gh",
    [
      "pr",
      "create",
      "--draft",
      "--title",
      summarizeCommit(job.prompt),
      "--body-file",
      bodyPath
    ],
    { cwd: worktree, timeoutMs: 120_000 }
  );
  if (pr.code !== 0) {
    await reporter.event("repo", "warn", "PR creation failed.", {
      stderr: pr.stderr.slice(-4000)
    });
    return;
  }
  await reporter.event("repo", "info", "Draft PR created.", {
    url: pr.stdout.trim()
  });
}

function buildPrompt(job: Job): string {
  return [
    "You are Uriel, a remote NixOS-first coding agent.",
    "Follow this repository's AGENTS.md instructions exactly.",
    `Branch: ${job.branch}`,
    job.issue ? `Issue: ${job.issue}` : undefined,
    `Requested QA: ${job.qa}`,
    "",
    job.prompt
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPullRequestBody(job: Job): string {
  return [
    `Automated Uriel job: ${job.id}`,
    "",
    `Source: ${job.source}`,
    `QA requested: ${job.qa}`,
    job.issue ? `Issue: ${job.issue}` : undefined,
    "",
    "Evidence artifacts are attached to the Uriel control plane job when configured."
  ]
    .filter(Boolean)
    .join("\n");
}

function summarizeCommit(prompt: string): string {
  const summary = prompt.split(/\n/u)[0]?.trim() || "Uriel agent changes";
  return summary.length > 72 ? `${summary.slice(0, 69)}...` : summary;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function metadataString(job: Job, key: string): string | undefined {
  const value = job.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
