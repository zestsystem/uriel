import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Job } from "../../../packages/core/src/index.ts";
import type { WorkerConfig } from "./config.ts";
import type { JobReporter } from "./reporter.ts";
import { commandExists, exists, runCommand } from "./shell.ts";

export async function runQa(
  job: Job,
  config: WorkerConfig,
  artifactsDir: string,
  reporter: JobReporter
): Promise<void> {
  if (job.qa === "none") {
    await reporter.event("qa", "info", "QA not requested for this job.");
    return;
  }

  if (job.qa === "browser" || job.qa === "both") {
    await runBrowserQa(config, artifactsDir, reporter);
  }

  if (job.qa === "android" || job.qa === "both") {
    await runAndroidQa(job, config, artifactsDir, reporter);
  }
}

async function runBrowserQa(
  config: WorkerConfig,
  artifactsDir: string,
  reporter: JobReporter
): Promise<void> {
  if (!config.browserUrl) {
    await reporter.event(
      "qa",
      "warn",
      "Skipping browser QA because URIEL_BROWSER_URL is not configured."
    );
    return;
  }

  if (!(await commandExists("npx"))) {
    await reporter.event("qa", "warn", "Skipping browser QA; npx is missing.");
    return;
  }

  const scriptPath = join(artifactsDir, "browser-qa.mjs");
  const screenshotPath = join(artifactsDir, "browser-screenshot.png");
  const tracePath = join(artifactsDir, "browser-trace.zip");
  const videoDir = join(artifactsDir, "browser-video");
  await writeFile(
    scriptPath,
    `
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  recordVideo: { dir: ${JSON.stringify(videoDir)} }
});
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
await page.goto(${JSON.stringify(config.browserUrl)}, { waitUntil: "networkidle", timeout: 60000 });
await page.screenshot({ path: ${JSON.stringify(screenshotPath)}, fullPage: true });
await context.tracing.stop({ path: ${JSON.stringify(tracePath)} });
await context.close();
await browser.close();
`,
    "utf8"
  );

  const result = await runCommand(
    "npx",
    ["--yes", "-p", "playwright", "node", scriptPath],
    { timeoutMs: 120_000 }
  );
  if (result.code !== 0) {
    await reporter.event("qa", "error", "Browser QA failed.", {
      stderr: result.stderr.slice(-4000)
    });
    return;
  }

  await uploadIfExists("browser-screenshot.png", screenshotPath, "image/png", reporter);
  await uploadIfExists("browser-trace.zip", tracePath, "application/zip", reporter);
  await reporter.event("qa", "info", "Browser QA completed.");
}

async function runAndroidQa(
  job: Job,
  config: WorkerConfig,
  artifactsDir: string,
  reporter: JobReporter
): Promise<void> {
  if (!(await exists("/dev/kvm"))) {
    await reporter.event(
      "qa",
      "warn",
      "Skipping Android QA because /dev/kvm is unavailable."
    );
    return;
  }

  if (!(await commandExists("adb"))) {
    await reporter.event("qa", "warn", "Skipping Android QA; adb is missing.");
    return;
  }

  if (config.androidAvd && (await commandExists("emulator"))) {
    await reporter.event("qa", "info", `Ensuring Android AVD ${config.androidAvd} is booted.`);
    await runCommand("sh", [
      "-lc",
      `pgrep -f "emulator.*${config.androidAvd}" >/dev/null || nohup emulator -avd ${config.androidAvd} -no-snapshot -no-audio -no-window >/tmp/uriel-emulator.log 2>&1 &`
    ]);
  }

  await runCommand("adb", ["start-server"], { timeoutMs: 30_000 });
  const devices = await runCommand("adb", ["devices"], { timeoutMs: 30_000 });
  if (!/\tdevice/u.test(devices.stdout)) {
    await reporter.event(
      "qa",
      "warn",
      "Skipping Android recording because no booted adb device is attached.",
      { devices: devices.stdout }
    );
    return;
  }

  const remotePath = `/sdcard/uriel-${job.id}.mp4`;
  const localPath = join(artifactsDir, "android-screenrecord.mp4");
  await reporter.event("qa", "info", "Recording Android screen for 10 seconds.");
  const record = await runCommand(
    "adb",
    ["shell", "screenrecord", "--time-limit", "10", remotePath],
    { timeoutMs: 20_000 }
  );
  if (record.code !== 0) {
    await reporter.event("qa", "error", "Android screenrecord failed.", {
      stderr: record.stderr.slice(-4000)
    });
    return;
  }
  const pull = await runCommand("adb", ["pull", remotePath, localPath], {
    timeoutMs: 30_000
  });
  await runCommand("adb", ["shell", "rm", "-f", remotePath], {
    timeoutMs: 30_000
  });
  if (pull.code !== 0) {
    await reporter.event("qa", "error", "Failed to pull Android recording.", {
      stderr: pull.stderr.slice(-4000)
    });
    return;
  }

  if (typeof job.metadata.maestroFlow === "string" && await commandExists("maestro")) {
    await reporter.event("qa", "info", `Running Maestro flow ${job.metadata.maestroFlow}.`);
    const maestro = await runCommand("maestro", ["test", job.metadata.maestroFlow], {
      timeoutMs: 180_000
    });
    await writeFile(join(artifactsDir, "maestro.log"), maestro.stdout + maestro.stderr);
    await uploadIfExists("maestro.log", join(artifactsDir, "maestro.log"), "text/plain", reporter);
  }

  await uploadIfExists("android-screenrecord.mp4", localPath, "video/mp4", reporter);
  await reporter.event("qa", "info", "Android QA completed.");
}

async function uploadIfExists(
  name: string,
  path: string,
  contentType: string,
  reporter: JobReporter
): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      return;
    }
    await reporter.uploadArtifact(name, await readFile(path), contentType);
  } catch {
    return;
  }
}
