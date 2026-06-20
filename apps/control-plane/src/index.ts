import { DurableObject } from "cloudflare:workers";

import {
  buildBranchName,
  createId,
  createJobEvent,
  isRecord,
  type Artifact,
  type CreateJobRequest,
  type Job,
  type JobEvent,
  type JobStatus,
  type JsonValue,
  validateCreateJobRequest,
  verifyDiscordSignature,
  verifyGitHubSignature,
  verifyLinearSignature,
  verifySlackSignature,
  verifyTwilioSignature
} from "../../../packages/core/src/index.ts";

type SecretName =
  | "DISCORD_PUBLIC_KEY"
  | "GITHUB_WEBHOOK_SECRET"
  | "LINEAR_WEBHOOK_SECRET"
  | "SLACK_SIGNING_SECRET"
  | "TWILIO_AUTH_TOKEN"
  | "URIEL_API_TOKEN"
  | "URIEL_WORKER_DISPATCH_URL"
  | "URIEL_WORKER_TOKEN";

const coordinatorName = "global";

export class JobCoordinator extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (request.method === "POST" && url.pathname === "/jobs") {
      const body = await readJson(request);
      const validation = validateCreateJobRequest(body);
      if (!validation.ok) {
        return json({ error: validation.error }, 400);
      }
      const job = createJob(validation.value);
      await this.putJob(job);
      await this.appendEvent(
        job.id,
        createJobEvent("accepted", "info", "Job accepted by control plane.")
      );
      return json(job, 202);
    }

    if (pathParts[0] === "jobs" && pathParts[1]) {
      const jobId = pathParts[1];
      const job = await this.getJob(jobId);
      if (!job) {
        return json({ error: "Job not found." }, 404);
      }

      if (request.method === "GET" && pathParts.length === 2) {
        return json(job);
      }

      if (
        request.method === "GET" &&
        pathParts.length === 3 &&
        pathParts[2] === "events"
      ) {
        return json(job.events);
      }

      if (
        request.method === "POST" &&
        pathParts.length === 3 &&
        pathParts[2] === "events"
      ) {
        const body = await readJson(request);
        const event = normalizeIncomingEvent(body);
        if (!event) {
          return json({ error: "Invalid job event." }, 400);
        }
        await this.appendEvent(jobId, event);
        return json({ ok: true }, 202);
      }

      if (
        request.method === "POST" &&
        pathParts.length === 3 &&
        pathParts[2] === "status"
      ) {
        const body = await readJson(request);
        if (!isRecord(body) || !isJobStatus(body.status)) {
          return json({ error: "Invalid status." }, 400);
        }
        const updated = await this.updateJob(jobId, {
          status: body.status,
          updatedAt: new Date().toISOString()
        });
        return json(updated);
      }

      if (
        request.method === "POST" &&
        pathParts.length === 4 &&
        pathParts[2] === "approve"
      ) {
        const stepId = pathParts[3];
        const updated = await this.updateJob(jobId, {
          approvals: job.approvals.filter(
            (approval) => approval.stepId !== stepId
          ),
          status: "queued",
          updatedAt: new Date().toISOString()
        });
        await this.appendEvent(
          jobId,
          createJobEvent("approval", "info", `Approved step ${stepId}.`)
        );
        return json(updated);
      }

      if (
        request.method === "POST" &&
        pathParts.length === 3 &&
        pathParts[2] === "cancel"
      ) {
        const updated = await this.updateJob(jobId, {
          status: "cancelled",
          updatedAt: new Date().toISOString()
        });
        await this.appendEvent(
          jobId,
          createJobEvent("job", "warn", "Job cancelled.")
        );
        return json(updated);
      }

      if (
        request.method === "POST" &&
        pathParts.length === 3 &&
        pathParts[2] === "retry"
      ) {
        const updated = await this.updateJob(jobId, {
          status: "queued",
          updatedAt: new Date().toISOString()
        });
        await this.appendEvent(
          jobId,
          createJobEvent("job", "info", "Job queued for retry.")
        );
        return json(updated);
      }
    }

    return json({ error: "Not found." }, 404);
  }

  private async getJob(jobId: string): Promise<Job | undefined> {
    return this.ctx.storage.get<Job>(jobKey(jobId));
  }

  private async putJob(job: Job): Promise<void> {
    await this.ctx.storage.put(jobKey(job.id), job);
    const ids = (await this.ctx.storage.get<string[]>("jobIds")) ?? [];
    if (!ids.includes(job.id)) {
      ids.unshift(job.id);
      await this.ctx.storage.put("jobIds", ids.slice(0, 500));
    }
  }

  private async updateJob(
    jobId: string,
    patch: Partial<Omit<Job, "id">>
  ): Promise<Job> {
    const current = await this.getJob(jobId);
    if (!current) {
      throw new Error(`Job ${jobId} does not exist.`);
    }
    const next = { ...current, ...patch };
    await this.ctx.storage.put(jobKey(jobId), next);
    return next;
  }

  private async appendEvent(jobId: string, event: JobEvent): Promise<Job> {
    const current = await this.getJob(jobId);
    if (!current) {
      throw new Error(`Job ${jobId} does not exist.`);
    }
    const next = {
      ...current,
      events: [...current.events, event].slice(-500),
      updatedAt: new Date().toISOString()
    };
    await this.ctx.storage.put(jobKey(jobId), next);
    return next;
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "uriel-control-plane" });
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, env, ctx);
    }

    if (url.pathname.startsWith("/webhooks/")) {
      return handleWebhookRequest(request, env, ctx);
    }

    return json({ error: "Not found." }, 404);
  }
} satisfies ExportedHandler<Env>;

async function handleApiRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const workerWrite =
    request.method === "POST" &&
    /^\/api\/jobs\/[^/]+\/(events|status)$/u.test(url.pathname);
  const artifactWrite =
    request.method === "PUT" &&
    /^\/api\/jobs\/[^/]+\/artifacts\/[^/]+/u.test(url.pathname);

  const requiredSecret = workerWrite || artifactWrite
    ? envString(env, "URIEL_WORKER_TOKEN")
    : envString(env, "URIEL_API_TOKEN");
  if (requiredSecret && !(await verifyBearer(request, requiredSecret))) {
    return json({ error: "Unauthorized." }, 401);
  }

  if (artifactWrite) {
    return putArtifact(request, env);
  }

  const coordinatorPath = url.pathname.replace(/^\/api/u, "");
  const response = await coordinator(env).fetch(cloneForPath(request, coordinatorPath));

  if (request.method === "POST" && url.pathname === "/api/jobs") {
    const cloned = response.clone();
    if (cloned.ok) {
      const job = (await cloned.json()) as Job;
      ctx.waitUntil(dispatchJob(env, job));
    }
  }

  return response;
}

async function handleWebhookRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const source = url.pathname.replace("/webhooks/", "");
  const body = await request.text();

  if (source === "discord") {
    const publicKey = envString(env, "DISCORD_PUBLIC_KEY");
    if (
      publicKey &&
      !(await verifyDiscordSignature(
        publicKey,
        request.headers.get("x-signature-timestamp"),
        body,
        request.headers.get("x-signature-ed25519")
      ))
    ) {
      return json({ error: "Invalid Discord signature." }, 401);
    }

    const payload = parseJsonObject(body);
    if (payload?.type === 1) {
      return json({ type: 1 });
    }

    const prompt = extractDiscordPrompt(payload);
    if (!prompt) {
      return json({ error: "No prompt found in Discord interaction." }, 400);
    }
    return createWebhookJob(env, ctx, {
      prompt,
      source: "discord",
      requestedBy: readNestedString(payload, ["member", "user", "id"]),
      metadata: { platform: "discord" }
    });
  }

  if (source === "github") {
    const secret = envString(env, "GITHUB_WEBHOOK_SECRET");
    if (
      secret &&
      !(await verifyGitHubSignature(
        secret,
        body,
        request.headers.get("x-hub-signature-256")
      ))
    ) {
      return json({ error: "Invalid GitHub signature." }, 401);
    }
    const payload = parseJsonObject(body);
    const prompt = extractGitHubPrompt(payload);
    if (!prompt) {
      return json({ ok: true, ignored: true });
    }
    return createWebhookJob(env, ctx, {
      prompt,
      repo: readNestedString(payload, ["repository", "html_url"]),
      source: "github",
      requestedBy: readNestedString(payload, ["sender", "login"]),
      metadata: { event: request.headers.get("x-github-event") ?? "unknown" }
    });
  }

  if (source === "linear") {
    const secret = envString(env, "LINEAR_WEBHOOK_SECRET");
    if (
      secret &&
      !(await verifyLinearSignature(
        secret,
        body,
        request.headers.get("linear-signature")
      ))
    ) {
      return json({ error: "Invalid Linear signature." }, 401);
    }
    const payload = parseJsonObject(body);
    const identifier =
      readNestedString(payload, ["data", "identifier"]) ??
      readNestedString(payload, ["issue", "identifier"]);
    const prompt = extractLinearPrompt(payload);
    if (!prompt) {
      return json({ ok: true, ignored: true });
    }
    return createWebhookJob(env, ctx, {
      prompt,
      issue: identifier,
      source: "linear",
      requestedBy: readNestedString(payload, ["actor", "name"]),
      metadata: { issueTracker: "linear", platform: "linear" }
    });
  }

  if (source === "slack") {
    const secret = envString(env, "SLACK_SIGNING_SECRET");
    if (
      secret &&
      !(await verifySlackSignature(
        secret,
        body,
        request.headers.get("x-slack-request-timestamp"),
        request.headers.get("x-slack-signature")
      ))
    ) {
      return json({ error: "Invalid Slack signature." }, 401);
    }
    const payload = parseJsonObject(body);
    if (payload?.type === "url_verification") {
      return json({ challenge: readNestedString(payload, ["challenge"]) });
    }
    const prompt = extractSlackPrompt(payload);
    if (!prompt) {
      return json({ ok: true, ignored: true });
    }
    return createWebhookJob(env, ctx, {
      prompt,
      source: "slack",
      requestedBy: readNestedString(payload, ["event", "user"]),
      metadata: { platform: "slack" }
    });
  }

  if (source === "twilio") {
    const secret = envString(env, "TWILIO_AUTH_TOKEN");
    const params = new URLSearchParams(body);
    if (
      secret &&
      !(await verifyTwilioSignature(
        secret,
        request.url,
        params,
        request.headers.get("x-twilio-signature")
      ))
    ) {
      return json({ error: "Invalid Twilio signature." }, 401);
    }
    const prompt = params.get("Body")?.trim();
    if (!prompt) {
      return json({ ok: true, ignored: true });
    }
    return createWebhookJob(env, ctx, {
      prompt,
      source: "twilio",
      requestedBy: params.get("From") ?? undefined,
      metadata: { platform: "twilio" }
    });
  }

  return json({ error: "Unknown webhook source." }, 404);
}

async function createWebhookJob(
  env: Env,
  ctx: ExecutionContext,
  partial: Omit<CreateJobRequest, "repo"> & { repo?: string }
): Promise<Response> {
  const repo = partial.repo ?? envString(env, "URIEL_DEFAULT_REPO");
  if (!repo) {
    return json({ error: "No repo configured for webhook job." }, 400);
  }

  const payload: CreateJobRequest = {
    ...partial,
    repo
  };
  const request = new Request("https://internal/jobs", {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  const response = await coordinator(env).fetch(request);
  const cloned = response.clone();
  if (cloned.ok) {
    const job = (await cloned.json()) as Job;
    ctx.waitUntil(dispatchJob(env, job));
  }
  return response;
}

async function putArtifact(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/api\/jobs\/([^/]+)\/artifacts\/(.+)$/u.exec(url.pathname);
  if (!match || !match[1] || !match[2]) {
    return json({ error: "Invalid artifact path." }, 400);
  }

  const jobId = decodeURIComponent(match[1]);
  const name = decodeURIComponent(match[2]);
  const key = `${jobId}/${name}`;
  await env.ARTIFACTS.put(key, request.body, {
    httpMetadata: {
      contentType:
        request.headers.get("content-type") ?? "application/octet-stream"
    }
  });

  const artifact: Artifact = {
    contentType: request.headers.get("content-type") ?? undefined,
    createdAt: new Date().toISOString(),
    kind: artifactKind(name),
    name,
    url: `/api/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(name)}`
  };
  await coordinator(env).fetch(
    new Request(`https://internal/jobs/${encodeURIComponent(jobId)}/events`, {
      body: JSON.stringify(
        createJobEvent("artifact", "info", `Uploaded artifact ${name}.`, {
          name,
          key
        })
      ),
      headers: { "content-type": "application/json" },
      method: "POST"
    })
  );

  return json({ ok: true, artifact }, 201);
}

async function dispatchJob(env: Env, job: Job): Promise<void> {
  const dispatchUrl = envString(env, "URIEL_WORKER_DISPATCH_URL");
  if (!dispatchUrl) {
    await coordinator(env).fetch(
      new Request(`https://internal/jobs/${job.id}/events`, {
        body: JSON.stringify(
          createJobEvent(
            "dispatch",
            "warn",
            "URIEL_WORKER_DISPATCH_URL is not configured; job remains queued."
          )
        ),
        headers: { "content-type": "application/json" },
        method: "POST"
      })
    );
    return;
  }

  const token = envString(env, "URIEL_WORKER_TOKEN");
  const response = await fetch(`${dispatchUrl.replace(/\/$/u, "")}/jobs`, {
    body: JSON.stringify(job),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    method: "POST"
  });

  await coordinator(env).fetch(
    new Request(`https://internal/jobs/${job.id}/events`, {
      body: JSON.stringify(
        createJobEvent(
          response.ok ? "dispatch" : "job",
          response.ok ? "info" : "error",
          response.ok
            ? "Dispatched job to NixOS worker."
            : `Worker dispatch failed with HTTP ${response.status}.`
        )
      ),
      headers: { "content-type": "application/json" },
      method: "POST"
    })
  );
}

function createJob(request: CreateJobRequest): Job {
  const now = new Date().toISOString();
  return {
    approvals: [],
    artifacts: [],
    branch: buildBranchName(request),
    createdAt: now,
    events: [],
    id: createId("job"),
    metadata: request.metadata ?? {},
    profile: request.profile ?? "generic",
    prompt: request.prompt,
    qa: request.qa ?? "none",
    repo: request.repo,
    source: request.source ?? "api",
    status: "queued",
    updatedAt: now,
    ...(request.issue ? { issue: request.issue } : {}),
    ...(request.requestedBy ? { requestedBy: request.requestedBy } : {})
  };
}

function coordinator(env: Env): DurableObjectStub<JobCoordinator> {
  const namespace = env.JOB_COORDINATOR;
  if (!namespace) {
    throw new Error("JOB_COORDINATOR binding is not configured.");
  }
  const id = namespace.idFromName(coordinatorName);
  return namespace.get(id);
}

function cloneForPath(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

function normalizeIncomingEvent(input: unknown): JobEvent | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const message = typeof input.message === "string" ? input.message : undefined;
  if (!message) {
    return undefined;
  }
  return {
    at: typeof input.at === "string" ? input.at : new Date().toISOString(),
    id: typeof input.id === "string" ? input.id : createId("evt"),
    level: normalizeEventLevel(input.level),
    message,
    type: normalizeEventType(input.type),
    ...(isJsonValue(input.data) ? { data: input.data } : {})
  };
}

function normalizeEventLevel(input: unknown): JobEvent["level"] {
  return input === "debug" ||
    input === "info" ||
    input === "warn" ||
    input === "error"
    ? input
    : "info";
}

function normalizeEventType(input: unknown): JobEvent["type"] {
  const allowed: JobEvent["type"][] = [
    "accepted",
    "artifact",
    "approval",
    "command",
    "dispatch",
    "job",
    "qa",
    "repo",
    "worker"
  ];
  return typeof input === "string" &&
    allowed.includes(input as JobEvent["type"])
    ? (input as JobEvent["type"])
    : "worker";
}

function isJsonValue(input: unknown): input is JsonValue {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(input)) {
    return input.every(isJsonValue);
  }
  if (isRecord(input)) {
    return Object.values(input).every(isJsonValue);
  }
  return false;
}

function isJobStatus(input: unknown): input is JobStatus {
  return (
    input === "queued" ||
    input === "running" ||
    input === "waiting_approval" ||
    input === "completed" ||
    input === "failed" ||
    input === "cancelled"
  );
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function parseJsonObject(body: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractDiscordPrompt(
  payload: Record<string, unknown> | undefined
): string | undefined {
  const options = readNested(payload, ["data", "options"]);
  if (Array.isArray(options)) {
    const promptOption = options.find(
      (option) => isRecord(option) && option.name === "prompt"
    );
    if (isRecord(promptOption) && typeof promptOption.value === "string") {
      return promptOption.value;
    }
  }
  return readNestedString(payload, ["data", "name"]);
}

function extractGitHubPrompt(
  payload: Record<string, unknown> | undefined
): string | undefined {
  const comment = readNestedString(payload, ["comment", "body"]);
  if (comment?.includes("@uriel")) {
    return comment.replace("@uriel", "").trim();
  }
  const title = readNestedString(payload, ["issue", "title"]);
  const body = readNestedString(payload, ["issue", "body"]);
  return title ? `${title}\n\n${body ?? ""}`.trim() : undefined;
}

function extractLinearPrompt(
  payload: Record<string, unknown> | undefined
): string | undefined {
  const comment = readNestedString(payload, ["comment", "body"]);
  if (comment?.includes("@uriel")) {
    return comment.replace("@uriel", "").trim();
  }
  const title =
    readNestedString(payload, ["data", "title"]) ??
    readNestedString(payload, ["issue", "title"]);
  const description =
    readNestedString(payload, ["data", "description"]) ??
    readNestedString(payload, ["issue", "description"]);
  return title ? `${title}\n\n${description ?? ""}`.trim() : undefined;
}

function extractSlackPrompt(
  payload: Record<string, unknown> | undefined
): string | undefined {
  const text = readNestedString(payload, ["event", "text"]);
  return text?.replace(/<@[^>]+>/gu, "").trim();
}

function readNestedString(
  input: Record<string, unknown> | undefined,
  path: string[]
): string | undefined {
  const value = readNested(input, path);
  return typeof value === "string" ? value : undefined;
}

function readNested(
  input: Record<string, unknown> | undefined,
  path: string[]
): unknown {
  let current: unknown = input;
  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

async function verifyBearer(
  request: Request,
  expectedSecret: string
): Promise<boolean> {
  const header = request.headers.get("authorization");
  const received = header?.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeFallback(received, expectedSecret);
}

function timingSafeFallback(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

function envString(env: Env, key: SecretName | "URIEL_DEFAULT_REPO"): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function artifactKind(name: string): Artifact["kind"] {
  if (/\.(png|jpg|jpeg|webp)$/iu.test(name)) {
    return "screenshot";
  }
  if (/\.(mp4|webm|mov)$/iu.test(name)) {
    return "video";
  }
  if (/\.(zip|trace)$/iu.test(name)) {
    return "trace";
  }
  if (/\.(jsonl?|txt|log)$/iu.test(name)) {
    return "log";
  }
  return "other";
}

function jobKey(jobId: string): string {
  return `job:${jobId}`;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}
