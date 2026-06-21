export interface WorkerConfig {
  androidAvd?: string;
  artifactsDir: string;
  browserUrl?: string;
  dryRun: boolean;
  host: string;
  issueTrackerAdapter?: string;
  issueTrackerApiKey?: string;
  issueTrackerInProgressState?: string;
  issueTrackerTeamKey?: string;
  opencodeModel?: string;
  port: number;
  repoBootstrapAdapter?: string;
  reposDir: string;
  stateDir: string;
  workerToken?: string;
  worktreesDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const stateDir = env.URIEL_STATE_DIR ?? "/var/lib/uriel";
  return {
    androidAvd: env.URIEL_ANDROID_AVD,
    artifactsDir: env.URIEL_ARTIFACTS_DIR ?? `${stateDir}/artifacts`,
    browserUrl: env.URIEL_BROWSER_URL,
    dryRun: env.URIEL_DRY_RUN === "1" || env.URIEL_DRY_RUN === "true",
    host: env.URIEL_WORKER_HOST ?? "127.0.0.1",
    issueTrackerAdapter: env.URIEL_ADAPTER_ISSUE_TRACKER,
    issueTrackerApiKey: env.URIEL_ADAPTER_ISSUE_TRACKER_API_KEY,
    issueTrackerInProgressState: env.URIEL_ADAPTER_ISSUE_TRACKER_IN_PROGRESS_STATE,
    issueTrackerTeamKey: env.URIEL_ADAPTER_ISSUE_TRACKER_TEAM_KEY,
    opencodeModel: env.OPENCODE_MODEL,
    port: Number.parseInt(env.URIEL_WORKER_PORT ?? "8788", 10),
    repoBootstrapAdapter: env.URIEL_ADAPTER_REPO_BOOTSTRAP,
    reposDir: env.URIEL_REPOS_DIR ?? `${stateDir}/repos`,
    stateDir,
    workerToken: env.URIEL_WORKER_TOKEN,
    worktreesDir: env.URIEL_WORKTREES_DIR ?? `${stateDir}/worktrees`
  };
}
