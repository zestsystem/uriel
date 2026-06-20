import { createJobEvent, type JobEvent, type JobStatus, type JsonValue } from "../../../packages/core/src/index.ts";

export interface ReporterOptions {
  controlPlaneUrl?: string;
  jobId: string;
  token?: string;
}

export class JobReporter {
  private readonly controlPlaneUrl?: string;
  private readonly jobId: string;
  private readonly token?: string;

  constructor(options: ReporterOptions) {
    this.controlPlaneUrl = options.controlPlaneUrl;
    this.jobId = options.jobId;
    this.token = options.token;
  }

  async event(
    type: JobEvent["type"],
    level: JobEvent["level"],
    message: string,
    data?: JsonValue
  ): Promise<void> {
    const event = createJobEvent(type, level, message, data);
    console.log(JSON.stringify(event));
    await this.post(`/api/jobs/${encodeURIComponent(this.jobId)}/events`, event);
  }

  async status(status: JobStatus): Promise<void> {
    await this.post(`/api/jobs/${encodeURIComponent(this.jobId)}/status`, {
      status
    });
  }

  async uploadArtifact(
    name: string,
    body: Blob | Buffer | string,
    contentType: string
  ): Promise<void> {
    if (!this.controlPlaneUrl) {
      return;
    }
    const url = new URL(
      `/api/jobs/${encodeURIComponent(this.jobId)}/artifacts/${encodeURIComponent(name)}`,
      this.controlPlaneUrl
    );
    const response = await fetch(url, {
      body: toFetchBody(body),
      headers: {
        "content-type": contentType,
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
      },
      method: "PUT"
    });
    if (!response.ok) {
      await this.event(
        "artifact",
        "warn",
        `Artifact upload failed for ${name} with HTTP ${response.status}.`
      );
    }
  }

  private async post(path: string, body: unknown): Promise<void> {
    if (!this.controlPlaneUrl) {
      return;
    }
    const response = await fetch(new URL(path, this.controlPlaneUrl), {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
      },
      method: "POST"
    });
    if (!response.ok) {
      console.error(
        `Failed to post ${path} to control plane: HTTP ${response.status}`
      );
    }
  }
}

function toFetchBody(body: Blob | Buffer | string): BodyInit {
  if (typeof body === "string" || body instanceof Blob) {
    return body;
  }

  const copy = new ArrayBuffer(body.byteLength);
  new Uint8Array(copy).set(body);
  return copy;
}
