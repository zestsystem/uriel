import type { Job } from "../../../packages/core/src/index.ts";

export interface LinearOptions {
  apiKey?: string;
  inProgressState?: string;
  teamKey?: string;
}

interface LinearGraphqlResponse {
  data?: unknown;
  errors?: unknown;
}

export async function ensureLinearIssue(
  job: Job,
  options: LinearOptions
): Promise<string | undefined> {
  if (job.issue) {
    await moveIssueToInProgress(job.issue, options);
    return job.issue;
  }

  if (!options.apiKey || !options.teamKey) {
    return undefined;
  }

  const teamId = await findTeamId(options.teamKey, options.apiKey);
  if (!teamId) {
    return undefined;
  }

  const response = await linearGraphql(options.apiKey, {
    query: `mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`,
    variables: {
      input: {
        description: `Created by Uriel for job ${job.id}.\n\n${job.prompt}`,
        teamId,
        title: summarizePrompt(job.prompt)
      }
    }
  });

  const issue = readPath(response.data, [
    "issueCreate",
    "issue",
    "identifier"
  ]);
  const identifier = typeof issue === "string" ? issue : undefined;
  if (identifier) {
    await moveIssueToInProgress(identifier, options);
  }
  return identifier;
}

async function moveIssueToInProgress(
  identifier: string,
  options: LinearOptions
): Promise<void> {
  if (!options.apiKey || !options.inProgressState) {
    return;
  }
  const issueId = await findIssueId(identifier, options.apiKey);
  if (!issueId) {
    return;
  }
  const stateId = await findStateId(options.inProgressState, options.apiKey);
  if (!stateId) {
    return;
  }
  await linearGraphql(options.apiKey, {
    query: `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`,
    variables: { id: issueId, input: { stateId } }
  });
}

async function findTeamId(
  teamKey: string,
  apiKey: string
): Promise<string | undefined> {
  const response = await linearGraphql(apiKey, {
    query: `query Teams {
      teams { nodes { id key } }
    }`
  });
  const nodes = readPath(response.data, ["teams", "nodes"]);
  if (!Array.isArray(nodes)) {
    return undefined;
  }
  const team = nodes.find(
    (node) =>
      isRecord(node) &&
      typeof node.key === "string" &&
      node.key.toLowerCase() === teamKey.toLowerCase()
  );
  return isRecord(team) && typeof team.id === "string" ? team.id : undefined;
}

async function findIssueId(
  identifier: string,
  apiKey: string
): Promise<string | undefined> {
  const response = await linearGraphql(apiKey, {
    query: `query Issue($id: String!) {
      issue(id: $id) { id }
    }`,
    variables: { id: identifier }
  });
  const issueId = readPath(response.data, ["issue", "id"]);
  return typeof issueId === "string" ? issueId : undefined;
}

async function findStateId(
  name: string,
  apiKey: string
): Promise<string | undefined> {
  const response = await linearGraphql(apiKey, {
    query: `query WorkflowStates {
      workflowStates { nodes { id name type } }
    }`
  });
  const nodes = readPath(response.data, ["workflowStates", "nodes"]);
  if (!Array.isArray(nodes)) {
    return undefined;
  }
  const state = nodes.find(
    (node) =>
      isRecord(node) &&
      typeof node.name === "string" &&
      node.name.toLowerCase() === name.toLowerCase()
  );
  return isRecord(state) && typeof state.id === "string" ? state.id : undefined;
}

async function linearGraphql(
  apiKey: string,
  payload: { query: string; variables?: Record<string, unknown> }
): Promise<LinearGraphqlResponse> {
  const response = await fetch("https://api.linear.app/graphql", {
    body: JSON.stringify(payload),
    headers: {
      authorization: apiKey,
      "content-type": "application/json"
    },
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`Linear GraphQL failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as LinearGraphqlResponse;
}

function summarizePrompt(prompt: string): string {
  return prompt.split(/\s+/u).slice(0, 12).join(" ").slice(0, 100);
}

function readPath(input: unknown, path: string[]): unknown {
  let current = input;
  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
