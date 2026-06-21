import type { Artifact, Job, JobEvent, JsonValue, QaMode } from "./types.ts";

export const adapterKinds = [
  "artifactStore",
  "harness",
  "issueTracker",
  "notifier",
  "qa",
  "repoBootstrap"
] as const;

export type AdapterKind = (typeof adapterKinds)[number];

export interface AdapterDescriptor {
  id: string;
  kind: AdapterKind;
  summary?: string;
  version?: string;
}

export interface AdapterContext {
  artifactsDir: string;
  emit(event: AdapterEvent): Promise<void>;
  job: Job;
  metadata: Record<string, JsonValue>;
  worktree: string;
}

export type AdapterEvent = Pick<JobEvent, "data" | "level" | "message" | "type">;

export interface ArtifactStoreAdapter extends AdapterDescriptor {
  kind: "artifactStore";
  getArtifact(context: AdapterContext, name: string): Promise<Artifact | undefined>;
  putArtifact(
    context: AdapterContext,
    artifact: Omit<Artifact, "createdAt" | "url">,
    body: Buffer | string
  ): Promise<Artifact>;
}

export interface HarnessAdapter extends AdapterDescriptor {
  kind: "harness";
  run(context: AdapterContext, request: HarnessRunRequest): Promise<HarnessRunResult>;
}

export interface HarnessRunRequest {
  model?: string;
  prompt: string;
}

export interface HarnessRunResult {
  changed: boolean;
  transcript?: Artifact;
}

export interface IssueTrackerAdapter extends AdapterDescriptor {
  kind: "issueTracker";
  ensureIssue(
    context: AdapterContext,
    request: IssueTrackerRequest
  ): Promise<IssueTrackerResult | undefined>;
}

export interface IssueTrackerRequest {
  issue?: string;
  prompt: string;
}

export interface IssueTrackerResult {
  id: string;
  url?: string;
}

export interface NotifierAdapter extends AdapterDescriptor {
  kind: "notifier";
  notify(context: AdapterContext, notification: JobNotification): Promise<void>;
}

export interface JobNotification {
  message: string;
  status: Job["status"];
  url?: string;
}

export interface QaAdapter extends AdapterDescriptor {
  kind: "qa";
  run(context: AdapterContext, request: QaRunRequest): Promise<QaRunResult>;
}

export interface QaRunRequest {
  mode: QaMode;
  targetUrl?: string;
}

export interface QaRunResult {
  artifacts: Artifact[];
  skipped?: string;
  summary: string;
}

export interface RepoBootstrapAdapter extends AdapterDescriptor {
  kind: "repoBootstrap";
  bootstrap(context: AdapterContext): Promise<void>;
}

export type UrielAdapter =
  | ArtifactStoreAdapter
  | HarnessAdapter
  | IssueTrackerAdapter
  | NotifierAdapter
  | QaAdapter
  | RepoBootstrapAdapter;

export class AdapterRegistry<TAdapter extends AdapterDescriptor = UrielAdapter> {
  private readonly adapters = new Map<string, TAdapter>();

  register(adapter: TAdapter): void {
    const key = adapterKey(adapter.kind, adapter.id);
    if (this.adapters.has(key)) {
      throw new Error(`Adapter already registered: ${key}`);
    }
    this.adapters.set(key, adapter);
  }

  get<TKind extends TAdapter["kind"]>(
    kind: TKind,
    id: string
  ): Extract<TAdapter, { kind: TKind }> | undefined {
    return this.adapters.get(adapterKey(kind, id)) as
      | Extract<TAdapter, { kind: TKind }>
      | undefined;
  }

  list<TKind extends TAdapter["kind"]>(
    kind?: TKind
  ): Array<Extract<TAdapter, { kind: TKind }>> {
    const values = [...this.adapters.values()];
    if (!kind) {
      return values as Array<Extract<TAdapter, { kind: TKind }>>;
    }
    return values.filter((adapter) => adapter.kind === kind) as Array<
      Extract<TAdapter, { kind: TKind }>
    >;
  }
}

export function adapterKey(kind: AdapterKind, id: string): string {
  return `${kind}:${id}`;
}
