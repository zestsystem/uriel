import type { Artifact, Job, JobStatus } from "./types.ts";
import type { RepoContract } from "./repo-contract.ts";

export interface EvidenceCommand {
  args: string[];
  command: string;
  cwd?: string;
  durationMs?: number;
  exitCode: number;
  stderrTail?: string;
  stdoutTail?: string;
}

export interface EvidencePullRequest {
  url: string;
}

export interface EvidenceQa {
  requested: Job["qa"];
  summaries: string[];
}

export interface EvidenceManifest {
  artifacts: Artifact[];
  commands: EvidenceCommand[];
  generatedAt: string;
  job: {
    branch: string;
    id: string;
    issue?: string;
    profile: string;
    prompt: string;
    repo: string;
    source: string;
    status: JobStatus;
  };
  outcome: {
    status: JobStatus;
    summary: string;
  };
  pullRequest?: EvidencePullRequest;
  qa: EvidenceQa;
  repoContract: RepoContract;
  schemaVersion: "1";
}

export function createEvidenceManifest(input: {
  artifacts?: Artifact[];
  commands?: EvidenceCommand[];
  job: Job;
  pullRequest?: EvidencePullRequest;
  qaSummaries?: string[];
  repoContract: RepoContract;
  summary?: string;
}): EvidenceManifest {
  return {
    artifacts: input.artifacts ?? [],
    commands: input.commands ?? [],
    generatedAt: new Date().toISOString(),
    job: {
      branch: input.job.branch,
      id: input.job.id,
      ...(input.job.issue ? { issue: input.job.issue } : {}),
      profile: input.job.profile,
      prompt: input.job.prompt,
      repo: input.job.repo,
      source: input.job.source,
      status: input.job.status
    },
    outcome: {
      status: input.job.status,
      summary: input.summary ?? `Job ${input.job.status}.`
    },
    ...(input.pullRequest ? { pullRequest: input.pullRequest } : {}),
    qa: {
      requested: input.job.qa,
      summaries: input.qaSummaries ?? []
    },
    repoContract: input.repoContract,
    schemaVersion: "1"
  };
}
