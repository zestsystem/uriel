import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";

import type { Job } from "../../../packages/core/src/index.ts";
import { loadConfig, type WorkerConfig } from "./config.ts";
import { runJob } from "./runner.ts";

const queue: { running: Promise<void> } = { running: Promise.resolve() };

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === "serve") {
    const config = loadConfig();
    const overrides = parseServeArgs(rest);
    await serve({ ...config, ...overrides });
    return;
  }

  if (command === "run") {
    const jobFile = valueAfter(rest, "--job-file");
    if (!jobFile) {
      throw new Error("uriel-worker run requires --job-file <path>.");
    }
    const job = JSON.parse(await readFile(jobFile, "utf8")) as Job;
    await runJob(job, loadConfig());
    return;
  }

  console.log(`Usage:
  uriel-worker serve [--host 127.0.0.1] [--port 8788]
  uriel-worker run --job-file ./job.json`);
}

async function serve(config: WorkerConfig): Promise<void> {
  const server = createServer((request, response) => {
    void handleRequest(request, response, config);
  });
  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, resolve);
  });
  console.log(`uriel-worker listening on http://${config.host}:${config.port}`);
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: WorkerConfig
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { ok: true, service: "uriel-worker" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/jobs") {
      if (config.workerToken && !authorized(request, config.workerToken)) {
        writeJson(response, 401, { error: "Unauthorized." });
        return;
      }
      const job = JSON.parse(await readBody(request, 1024 * 1024)) as Job;
      queue.running = queue.running.then(() => runJob(job, config));
      writeJson(response, 202, { ok: true, jobId: job.id });
      return;
    }

    writeJson(response, 404, { error: "Not found." });
  } catch (error) {
    writeJson(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function authorized(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization;
  const received = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (received.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < received.length; index += 1) {
    diff |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

async function readBody(
  request: IncomingMessage,
  maxBytes: number
): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function parseServeArgs(args: string[]): Partial<WorkerConfig> {
  return {
    ...(valueAfter(args, "--host") ? { host: valueAfter(args, "--host") } : {}),
    ...(valueAfter(args, "--port")
      ? { port: Number.parseInt(valueAfter(args, "--port") ?? "8788", 10) }
      : {})
  };
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

void main(process.argv.slice(2)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
