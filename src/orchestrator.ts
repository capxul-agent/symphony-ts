import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, existsSync, rmSync, appendFileSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { GraphQLClient, gql } from "graphql-request";
import { z } from "zod";

// ─── Domain Types ───────────────────────────────────────────────────────────

export interface Issue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
  readonly priority: number | null;
  readonly labels: ReadonlyArray<string>;
  readonly branchName: string | null;
  readonly url: string | null;
  readonly blockedBy: ReadonlyArray<{ readonly id: string | null; readonly identifier: string | null; readonly state: string | null }>;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface WorkflowConfig {
  readonly tracker: { readonly kind: "linear"; readonly projectSlug: string };
  readonly states: { readonly active: string[]; readonly terminal: string[] };
  readonly codex: { readonly command: string; readonly readTimeoutMs: number; readonly turnTimeoutMs: number; readonly stallTimeoutMs: number };
  readonly workspace: { readonly root: string };
  readonly hooks?: { readonly preRun?: string; readonly postRun?: string };
}

export interface Workflow {
  readonly config: WorkflowConfig;
  readonly promptTemplate: string;
}

export interface WorkerState {
  readonly issueId: string;
  readonly status: "running" | "completed" | "failed" | "stopped";
  readonly sessionId: string | null;
  readonly startedAt: string;
  readonly lastHeartbeat: string | null;
}

export interface JsonRpcMessage {
  readonly jsonrpc: "2.0";
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

export interface AgentEvent {
  readonly event: string;
  readonly timestamp: string;
  readonly sessionId: string | null;
  readonly payload: unknown | null;
}

export interface AppConfig {
  readonly linearApiKey: string;
  readonly linearProjectSlug: string;
  readonly workspaceRoot: string;
  readonly codexCommand: string;
  readonly pollIntervalMs: number;
  readonly maxConcurrentWorkers: number;
  readonly turnTimeoutMs: number;
  readonly dashboardPort: number;
}

export function makeConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    linearApiKey: process.env.LINEAR_API_KEY || "",
    linearProjectSlug: process.env.LINEAR_PROJECT_SLUG || "symphony",
    workspaceRoot: process.env.WORKSPACE_ROOT || "/opt/symphony-ts/workspaces",
    codexCommand: process.env.CODEX_COMMAND || "python3 /opt/symphony/kimi_cli_bridge.py",
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 30000,
    maxConcurrentWorkers: Number(process.env.MAX_CONCURRENT_WORKERS) || 3,
    turnTimeoutMs: Number(process.env.TURN_TIMEOUT_MS) || 300000,
    dashboardPort: Number(process.env.DASHBOARD_PORT) || 8793,
    ...overrides,
  };
}

// ─── Linear Client ────────────────────────────────────────────────────────

const LINEAR_ENDPOINT = "https://api.linear.app/graphql";

export class LinearClient {
  private client: GraphQLClient;

  constructor(apiKey: string) {
    this.client = new GraphQLClient(LINEAR_ENDPOINT, {
      headers: { Authorization: apiKey },
    });
  }

  async fetchCandidateIssues(projectSlug: string, activeStates: string[]): Promise<Issue[]> {
    const query = gql`
      query($projectSlug: String!, $states: [String!]!) {
        issues(
          filter: {
            project: { slugId: { eq: $projectSlug } }
            state: { name: { in: $states } }
          }
        ) {
          nodes {
            id
            identifier
            title
            description
            state { name }
            priority
            labels { nodes { name } }
            createdAt
            updatedAt
            url
          }
        }
      }
    `;
    const data = await this.client.request(query, { projectSlug, states: activeStates }) as any;
    return data.issues.nodes.map((node: any) => ({
      id: node.id,
      identifier: node.identifier,
      title: node.title,
      description: node.description || null,
      state: node.state.name,
      priority: node.priority ?? null,
      labels: node.labels?.nodes.map((l: any) => l.name.toLowerCase()) || [],
      branchName: null,
      url: node.url,
      blockedBy: [],
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    }));
  }

  async rawQuery(query: string, variables?: Record<string, unknown>): Promise<unknown> {
    return await this.client.request(query, variables || {});
  }
}

// ─── Workspace Manager ────────────────────────────────────────────────────

export class WorkspaceManager {
  constructor(private root: string) {
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
  }

  getWorkspacePath(issueIdentifier: string): string {
    const sanitized = issueIdentifier.replace(/[^A-Za-z0-9._-]/g, "_");
    return resolve(join(this.root, sanitized));
  }

  ensureWorkspace(issueIdentifier: string): string {
    const path = this.getWorkspacePath(issueIdentifier);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
    return path;
  }

  cleanup(issueIdentifier: string): void {
    const path = this.getWorkspacePath(issueIdentifier);
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

// ─── Agent Runner ─────────────────────────────────────────────────────────

export class AgentRunner {
  private processes = new Map<string, ChildProcess>();
  private tools: Array<{ name: string; description: string; inputSchema: unknown }> = [];

  constructor(private config: AppConfig) {}

  setTools(tools: Array<{ name: string; description: string; inputSchema: unknown }>): void {
    this.tools = tools;
  }

  kill(issueId: string): void {
    const proc = this.processes.get(issueId);
    if (proc) {
      proc.kill("SIGTERM");
      this.processes.delete(issueId);
    }
  }

  async run(workspace: string, prompt: string, issue: { identifier: string; title: string; id: string }): Promise<AgentEvent[]> {
    if (!existsSync(workspace)) {
      mkdirSync(workspace, { recursive: true });
    }

    const [cmd, ...args] = this.config.codexCommand.split(" ");
    const proc = spawn(cmd, args, {
      cwd: workspace,
      env: { ...process.env, SYMPHONY_TOOLS: JSON.stringify(this.tools) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.processes.set(issue.id, proc);

    let buffer = "";
    const pending = new Map<number | string, { resolve: (m: JsonRpcMessage) => void; reject: (e: Error) => void }>();
    let requestId = 0;

    proc.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as JsonRpcMessage;
          if ("id" in msg && pending.has(msg.id!)) {
            const handler = pending.get(msg.id!)!;
            pending.delete(msg.id!);
            handler.resolve(msg);
          }
        } catch {
          // Ignore non-JSON lines
        }
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      console.error("[agent stderr]", data.toString());
    });

    function send(method: string, params?: Record<string, unknown>): Promise<JsonRpcMessage> {
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
        pending.set(id, { resolve, reject });
        proc.stdin?.write(JSON.stringify(message) + "\n");
      });
    }

    try {
      await new Promise(r => setTimeout(r, 500));

      await send("initialize", {
        capabilities: { experimentalApi: true },
        clientInfo: { name: "symphony-ts", version: "1.0.0" },
      });
      
      const threadResp = await send("thread/start", {
        approvalPolicy: "auto",
        sandbox: "none",
        cwd: workspace,
      });
      const threadId = (threadResp.result as any)?.thread?.id;
      if (!threadId) {
        throw new Error("No thread ID returned");
      }

      const turnResp = await send("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt }],
        cwd: workspace,
        title: `${issue.identifier}: ${issue.title}`,
      });
      const turnId = (turnResp.result as any)?.turn?.id;

      // Wait for Kimi to finish processing
      await new Promise(r => setTimeout(r, 60000));

      return [{
        event: "session_completed",
        timestamp: new Date().toISOString(),
        sessionId: `${threadId}-${turnId || "unknown"}`,
        payload: null,
      }];
    } finally {
      proc.stdin?.end();
      proc.kill();
      this.processes.delete(issue.id);
    }
  }
}

// ─── Hooks ────────────────────────────────────────────────────────────────

export const HookConfigSchema = z.object({
  after_create: z.string().optional(),
  before_run: z.string().optional(),
  after_run: z.string().optional(),
  before_remove: z.string().optional(),
  timeout_ms: z.number().int().min(1000).optional().default(300_000),
});

export type HookConfig = z.infer<typeof HookConfigSchema>;
export type HookName = "after_create" | "before_run" | "after_run" | "before_remove";

export interface Hooks {
  execute(hookName: HookName, workspacePath: string, env?: Record<string, string>): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export function createHooks(config: HookConfig): Hooks {
  return {
    execute: async (hookName, workspacePath, env = {}) => {
      const command = config[hookName];
      if (!command) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      const proc = Bun.spawn({
        cmd: ["/bin/sh", "-lc", command],
        cwd: workspacePath,
        env: { ...process.env, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });

      await proc.exited;

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = proc.exitCode ?? -1;

      return { exitCode, stdout, stderr };
    },
  };
}

export async function runHook(
  hooks: Hooks,
  hookName: HookName,
  workspacePath: string,
  env?: Record<string, string>
): Promise<void> {
  try {
    const result = await hooks.execute(hookName, workspacePath, env);
    if (result.exitCode !== 0) {
      console.warn(`Hook ${hookName} failed with exit code ${result.exitCode}: ${result.stderr}`);
    }
  } catch (e) {
    console.warn(`Hook ${hookName} threw:`, e);
  }
}

// ─── Retry Queue ──────────────────────────────────────────────────────────

export interface RetryEntry {
  issueId: string;
  attempt: number;
  dueAt: number;
  error?: string;
}

const BASE_DELAY_MS = 10_000;
const MAX_DELAY_MS = 60_000;
const MAX_RETRIES = 5;

function computeBackoff(attempt: number): number {
  const power = Math.min(attempt - 1, 10);
  return Math.min(BASE_DELAY_MS * Math.pow(2, power), MAX_DELAY_MS);
}

export function shouldRetry(attempt: number): boolean {
  return attempt <= MAX_RETRIES;
}

export interface RetryQueue {
  add(issueId: string, attempt: number, error?: string): void;
  next(): RetryEntry | null;
  remove(issueId: string): void;
  list(): RetryEntry[];
  size(): number;
}

export function createRetryQueue(): RetryQueue {
  const entries = new Map<string, RetryEntry>();

  return {
    add: (issueId, attempt, error) => {
      const now = performance.now();
      const delay = computeBackoff(attempt);
      entries.set(issueId, { issueId, attempt, dueAt: now + delay, error });
    },
    next: () => {
      const now = performance.now();
      let next: RetryEntry | null = null;
      for (const entry of entries.values()) {
        if (entry.dueAt <= now) {
          if (!next || entry.dueAt < next.dueAt) {
            next = entry;
          }
        }
      }
      return next;
    },
    remove: (issueId) => {
      entries.delete(issueId);
    },
    list: () =>
      Array.from(entries.values()).sort((a, b) => a.dueAt - b.dueAt),
    size: () => entries.size,
  };
}

// ─── Reconciler ───────────────────────────────────────────────────────────

export interface Reconciler {
  reconcile(
    linearIssues: Array<{ id: string; state: string }>,
    activeRuns: Record<string, { issueId: string; identifier: string; state: string }>
  ): { toStop: string[]; toCleanup: string[]; toRefresh: string[] };
  isTerminalState(state: string): boolean;
}

export function createReconciler(terminalStates: string[], activeStates: string[]): Reconciler {
  const terminalSet = new Set(terminalStates.map((s) => s.toLowerCase()));
  const activeSet = new Set(activeStates.map((s) => s.toLowerCase()));

  return {
    reconcile: (linearIssues, activeRuns) => {
      const toStop: string[] = [];
      const toCleanup: string[] = [];
      const toRefresh: string[] = [];

      const visibleIssueIds = new Set(linearIssues.map((i) => i.id));

      for (const [issueId, run] of Object.entries(activeRuns)) {
        const linearIssue = linearIssues.find((i) => i.id === issueId);

        if (!linearIssue) {
          toStop.push(issueId);
          toCleanup.push(issueId);
          continue;
        }

        const normalizedState = linearIssue.state.toLowerCase().trim();

        if (terminalSet.has(normalizedState)) {
          toStop.push(issueId);
          toCleanup.push(issueId);
        } else if (!activeSet.has(normalizedState)) {
          toStop.push(issueId);
        } else {
          toRefresh.push(issueId);
        }
      }

      return { toStop, toCleanup, toRefresh };
    },
    isTerminalState: (state: string) => terminalSet.has(state.toLowerCase().trim()),
  };
}

// ─── Token Accountant ───────────────────────────────────────────────────────

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface TokenRecord {
  timestamp: string;
  issueId: string;
  runId: string;
  usage: TokenUsage;
}

export interface TokenAccountant {
  record(issueId: string, runId: string, usage: TokenUsage): void;
  parseKimiOutput(output: string): TokenUsage;
  getTotals(workspacePath: string): { perRun: Record<string, TokenUsage>; perIssue: Record<string, TokenUsage>; total: TokenUsage };
}

export function createTokenAccountant(): TokenAccountant {
  return {
    record: (issueId, runId, usage) => {
      const record: TokenRecord = {
        timestamp: new Date().toISOString(),
        issueId,
        runId,
        usage,
      };
      appendFileSync("symphony-tokens.jsonl", JSON.stringify(record) + "\n");
    },

    parseKimiOutput: (output: string) => {
      const turnEndMatch = output.match(
        /TurnEnd\s*\(\s*total_tokens\s*=\s*(\d+)\s*,\s*input_tokens\s*=\s*(\d+)\s*,\s*output_tokens\s*=\s*(\d+)\s*\)/
      );
      if (turnEndMatch) {
        return {
          total_tokens: parseInt(turnEndMatch[1], 10),
          input_tokens: parseInt(turnEndMatch[2], 10),
          output_tokens: parseInt(turnEndMatch[3], 10),
        };
      }
      const totalMatch = output.match(/total_tokens\s*=\s*(\d+)/);
      const inputMatch = output.match(/input_tokens\s*=\s*(\d+)/);
      const outputMatch = output.match(/output_tokens\s*=\s*(\d+)/);
      return {
        total_tokens: totalMatch ? parseInt(totalMatch[1], 10) : undefined,
        input_tokens: inputMatch ? parseInt(inputMatch[1], 10) : undefined,
        output_tokens: outputMatch ? parseInt(outputMatch[1], 10) : undefined,
      };
    },

    getTotals: (workspacePath: string) => {
      const perRun: Record<string, TokenUsage> = {};
      const perIssue: Record<string, TokenUsage> = {};
      let total: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

      const logPath = `${workspacePath}/.symphony/tokens.jsonl`;
      if (!existsSync(logPath)) {
        return { perRun, perIssue, total };
      }

      const lines = readFileSync(logPath, "utf-8").trim().split("\n");
      for (const line of lines) {
        if (!line) continue;
        try {
          const record = JSON.parse(line) as TokenRecord;
          const usage = record.usage;
          perRun[record.runId] = addUsage(perRun[record.runId], usage);
          perIssue[record.issueId] = addUsage(perIssue[record.issueId], usage);
          total = addUsage(total, usage);
        } catch {
          // Skip invalid lines
        }
      }

      return { perRun, perIssue, total };
    },
  };
}

function addUsage(a: TokenUsage | undefined, b: TokenUsage): TokenUsage {
  return {
    input_tokens: (a?.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b.output_tokens ?? 0),
    total_tokens: (a?.total_tokens ?? 0) + (b.total_tokens ?? 0),
  };
}

// ─── Prompt Builder ───────────────────────────────────────────────────────

export interface PromptBuilder {
  build(issue: { id: string; identifier: string; title: string; description?: string; state: string }, workflow: { tools: string[]; states: Record<string, string> }, promptPath?: string): string;
}

export function createPromptBuilder(): PromptBuilder {
  return {
    build: (issue, workflow, promptPath = ".symphony/prompt.md") => {
      let template: string;
      if (existsSync(promptPath)) {
        template = readFileSync(promptPath, "utf-8");
      } else {
        template = `You are working on issue {{issue.identifier}}: {{issue.title}}

{{#if issue.description}}
Description: {{issue.description}}
{{/if}}

Available tools: {{workflow.tools}}

Current state: {{issue.state}}
Target states: {{workflow.states}}`;
      }

      let result = template;
      result = result.replace(/\{\{\s*issue\.id\s*\}\}/g, issue.id);
      result = result.replace(/\{\{\s*issue\.identifier\s*\}\}/g, issue.identifier);
      result = result.replace(/\{\{\s*issue\.title\s*\}\}/g, issue.title);
      result = result.replace(/\{\{\s*issue\.description\s*\}\}/g, issue.description || "");
      result = result.replace(/\{\{\s*issue\.state\s*\}\}/g, issue.state);
      result = result.replace(/\{\{\s*workflow\.tools\s*\}\}/g, JSON.stringify(workflow.tools));
      result = result.replace(/\{\{\s*workflow\.states\s*\}\}/g, JSON.stringify(workflow.states));
      result = result.replace(/\{\{\s*#if\s+issue\.description\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g, issue.description ? "$1" : "");

      return result;
    },
  };
}

// ─── Linear GraphQL Tool ──────────────────────────────────────────────────

export const LINEAR_GRAPHQL_TOOL = {
  name: "linear_graphql",
  description: "Execute a raw GraphQL query or mutation against Linear using Symphony's configured auth.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", description: "GraphQL query or mutation document to execute against Linear." },
      variables: { type: ["object", "null"], description: "Optional GraphQL variables object.", additionalProperties: true },
    },
  },
};

export interface LinearGraphqlTool {
  execute(input: { query: string; variables?: Record<string, unknown> }): Promise<string>;
}

export function createLinearGraphqlTool(
  graphqlClient: (query: string, variables?: Record<string, unknown>) => Promise<unknown>
): LinearGraphqlTool {
  return {
    execute: async (input) => {
      const response = await graphqlClient(input.query, input.variables);
      return JSON.stringify(response);
    },
  };
}

// ─── Workflow Loader ──────────────────────────────────────────────────────

export async function loadWorkflow(path: string): Promise<Workflow> {
  // Simple YAML-like parsing for WORKFLOW.md
  const content = readFileSync(path, "utf-8");
  
  // Extract config section between ```yaml and ```
  const yamlMatch = content.match(/```yaml\n([\s\S]*?)```/);
  const yamlContent = yamlMatch ? yamlMatch[1] : content;
  
  // Extract prompt template after the yaml block
  const promptMatch = content.match(/```yaml\n[\s\S]*?```\n\n([\s\S]*)/);
  const promptTemplate = promptMatch ? promptMatch[1].trim() : "Work on issue {{issue.identifier}}: {{issue.title}}";

  // Parse YAML-like content
  const lines = yamlContent.split("\n");
  let trackerKind = "linear";
  let projectSlug = "";
  const activeStates: string[] = [];
  const terminalStates: string[] = [];
  let codexCommand = "python3 /opt/symphony/kimi_cli_bridge.py";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("tracker:")) {
      const parts = trimmed.split(":");
      if (parts.length >= 3) {
        trackerKind = parts[1].trim();
        projectSlug = parts[2].trim();
      }
    } else if (trimmed.startsWith("states:")) {
      // Parse states list
      const statesStr = trimmed.substring(7).trim();
      const states = statesStr.split(",").map(s => s.trim()).filter(Boolean);
      // Assume first n-2 are active, last 2 are terminal (Done, Canceled)
      if (states.length >= 2) {
        activeStates.push(...states.slice(0, -2));
        terminalStates.push(...states.slice(-2));
      }
    } else if (trimmed.startsWith("codex.command:")) {
      codexCommand = trimmed.substring(14).trim();
    }
  }

  return {
    config: {
      tracker: { kind: "linear" as const, projectSlug },
      states: { active: activeStates.length > 0 ? activeStates : ["Todo", "In Progress", "In Review"], terminal: terminalStates.length > 0 ? terminalStates : ["Done", "Canceled"] },
      codex: { command: codexCommand, readTimeoutMs: 30000, turnTimeoutMs: 300000, stallTimeoutMs: 60000 },
      workspace: { root: "/opt/symphony-ts/workspaces" },
    },
    promptTemplate,
  };
}

// ─── Server ───────────────────────────────────────────────────────────────

export interface OrchestratorSnapshot {
  running: Array<{
    issueId: string;
    identifier: string;
    state: string;
    workerHost?: string;
    workspacePath?: string;
    sessionId?: string;
    codexInputTokens: number;
    codexOutputTokens: number;
    codexTotalTokens: number;
    turnCount: number;
    startedAt: string;
    lastCodexTimestamp?: string;
    lastCodexMessage?: string;
    runtimeSeconds: number;
  }>;
  retrying: Array<{
    issueId: string;
    attempt: number;
    dueInMs: number;
    identifier?: string;
    error?: string;
    workerHost?: string;
    workspacePath?: string;
  }>;
  codexTotals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    secondsRunning: number;
  };
  polling: {
    checking: boolean;
    nextPollInMs: number | null;
    pollIntervalMs: number;
  };
}

export interface Server {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createServer(
  config: { port: number; host: string },
  getSnapshot: () => OrchestratorSnapshot
): Server {
  let server: ReturnType<typeof Bun.serve> | null = null;

  const htmlDashboard = `<!DOCTYPE html>
<html>
<head>
  <title>Symphony Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #0a0a0a; color: #e0e0e0; }
    h1 { color: #fff; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 2rem 0; }
    .metric-card { background: #1a1a1a; padding: 1.5rem; border-radius: 8px; border: 1px solid #333; }
    .metric-label { color: #888; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .metric-value { font-size: 2rem; font-weight: 600; color: #fff; margin: 0.5rem 0; }
    .metric-detail { color: #666; font-size: 0.875rem; }
    .section { background: #1a1a1a; padding: 1.5rem; border-radius: 8px; border: 1px solid #333; margin: 1rem 0; }
    .section-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #333; }
    th { color: #888; font-weight: 500; }
    .status-badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem; }
    .status-running { background: #22c55e20; color: #22c55e; }
    .status-retrying { background: #f59e0b20; color: #f59e0b; }
    .empty-state { color: #666; font-style: italic; padding: 2rem; text-align: center; }
  </style>
</head>
<body>
  <h1>🔮 Symphony Operations Dashboard</h1>
  <p>Current state, retry pressure, token usage, and orchestration health.</p>
  
  <div class="metric-grid">
    <div class="metric-card">
      <div class="metric-label">Running</div>
      <div class="metric-value" id="running-count">0</div>
      <div class="metric-detail">Active issue sessions</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Retrying</div>
      <div class="metric-value" id="retrying-count">0</div>
      <div class="metric-detail">Issues waiting for retry</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Tokens</div>
      <div class="metric-value" id="total-tokens">0</div>
      <div class="metric-detail">In <span id="input-tokens">0</span> / Out <span id="output-tokens">0</span></div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Runtime</div>
      <div class="metric-value" id="runtime">0s</div>
      <div class="metric-detail">Total Codex runtime</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Running Sessions</div>
    <div id="running-table"></div>
  </div>

  <div class="section">
    <div class="section-title">Retry Queue</div>
    <div id="retrying-table"></div>
  </div>

  <script>
    async function refresh() {
      const res = await fetch('/api/v1/state');
      const data = await res.json();
      
      document.getElementById('running-count').textContent = data.running.length;
      document.getElementById('retrying-count').textContent = data.retrying.length;
      document.getElementById('total-tokens').textContent = data.codexTotals.totalTokens.toLocaleString();
      document.getElementById('input-tokens').textContent = data.codexTotals.inputTokens.toLocaleString();
      document.getElementById('output-tokens').textContent = data.codexTotals.outputTokens.toLocaleString();
      document.getElementById('runtime').textContent = data.codexTotals.secondsRunning + 's';
      
      const runningHtml = data.running.length === 0 
        ? '<div class="empty-state">No active sessions.</div>'
        : '<table><tr><th>Issue</th><th>State</th><th>Session</th><th>Runtime</th><th>Tokens</th></tr>' +
          data.running.map(r => 
            '<tr><td>' + r.identifier + '</td><td>' + r.state + '</td><td>' + (r.sessionId || 'n/a') + '</td><td>' + r.runtimeSeconds + 's</td><td>' + r.codexTotalTokens + '</td></tr>'
          ).join('') + '</table>';
      document.getElementById('running-table').innerHTML = runningHtml;
      
      const retryingHtml = data.retrying.length === 0
        ? '<div class="empty-state">No retrying issues.</div>'
        : '<table><tr><th>Issue</th><th>Attempt</th><th>Due In</th><th>Error</th></tr>' +
          data.retrying.map(r =>
            '<tr><td>' + (r.identifier || r.issueId) + '</td><td>' + r.attempt + '</td><td>' + Math.round(r.dueInMs / 1000) + 's</td><td>' + (r.error || '') + '</td></tr>'
          ).join('') + '</table>';
      document.getElementById('retrying-table').innerHTML = retryingHtml;
    }
    
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;

  return {
    start: () => {
      server = Bun.serve({
        port: config.port,
        hostname: config.host,
        routes: {
          "/": new Response(htmlDashboard, {
            headers: { "Content-Type": "text/html" },
          }),
          "/api/v1/state": {
            GET: () => {
              const snapshot = getSnapshot();
              return Response.json(snapshot);
            },
          },
          "/api/v1/issues/:id": {
            GET: (req) => {
              const id = req.params.id;
              const snapshot = getSnapshot();
              const issue = snapshot.running.find((r) => r.issueId === id || r.identifier === id);
              if (!issue) {
                return new Response(JSON.stringify({ error: "Not found" }), {
                  status: 404,
                  headers: { "Content-Type": "application/json" },
                });
              }
              return Response.json(issue);
            },
          },
          "/api/v1/refresh": {
            POST: () => {
              return Response.json({ queued: true, operations: ["poll", "reconcile"] });
            },
          },
        },
        fetch(req) {
          return new Response("Not Found", { status: 404 });
        },
      });

      console.log(`Symphony server running on http://${config.host}:${config.port}`);
    },

    stop: () => {
      if (server) {
        server.stop();
        server = null;
        console.log("Symphony server stopped");
      }
    },

    isRunning: () => server !== null,
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export class Orchestrator {
  private state = new Map<string, WorkerState>();
  private tracker: LinearClient;
  private workspaces: WorkspaceManager;
  private agent: AgentRunner;
  private retryQueue: RetryQueue;
  private reconciler: Reconciler;
  private hooks: Hooks;
  private tokenAccountant: TokenAccountant;
  private promptBuilder: PromptBuilder;
  private linearTool: LinearGraphqlTool;
  private server: Server;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPollTime: string | null = null;

  constructor(
    private config: AppConfig,
    private workflowPath: string,
    hookConfig?: HookConfig
  ) {
    this.tracker = new LinearClient(config.linearApiKey);
    this.workspaces = new WorkspaceManager(config.workspaceRoot);
    this.agent = new AgentRunner(config);
    this.retryQueue = createRetryQueue();
    this.tokenAccountant = createTokenAccountant();
    this.promptBuilder = createPromptBuilder();
    this.reconciler = createReconciler(["done", "canceled"], ["todo", "in progress", "in review"]);
    this.hooks = createHooks(hookConfig || {});
    this.linearTool = createLinearGraphqlTool((query, variables) =>
      this.tracker.rawQuery(query, variables)
    );
    this.server = createServer(
      { port: config.dashboardPort, host: "0.0.0.0" },
      () => this.buildSnapshot()
    );
  }

  async start(): Promise<void> {
    console.log("[symphony] Starting orchestrator...");

    const workflow = await loadWorkflow(this.workflowPath);

    // Re-initialize reconciler with actual workflow states
    this.reconciler = createReconciler(
      workflow.config.states.terminal,
      workflow.config.states.active
    );

    // Inject linear_graphql tool into agent
    this.agent.setTools([LINEAR_GRAPHQL_TOOL]);

    console.log(`[symphony] Loaded workflow for project: ${workflow.config.tracker.projectSlug}`);
    console.log(`[symphony] Active states: ${workflow.config.states.active.join(", ")}`);
    console.log(`[symphony] Terminal states: ${workflow.config.states.terminal.join(", ")}`);

    // Start HTTP server
    this.server.start();

    // Do initial tick
    await this.tick(workflow);

    // Schedule recurring ticks
    this.timer = setInterval(() => {
      this.tick(workflow).catch((e) => console.error("[symphony] Tick error:", e));
    }, this.config.pollIntervalMs);

    console.log(`[symphony] Polling every ${this.config.pollIntervalMs}ms`);
    console.log(`[symphony] Dashboard: http://localhost:${this.config.dashboardPort}`);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.server.stop();
    console.log("[symphony] Orchestrator stopped");
  }

  private async tick(workflow: Workflow): Promise<void> {
    try {
      this.lastPollTime = new Date().toISOString();

      // 1. Fetch candidate issues from Linear
      let issues: Issue[] = [];
      try {
        issues = await this.tracker.fetchCandidateIssues(
          this.config.linearProjectSlug,
          workflow.config.states.active
        );
      } catch (e) {
        console.error("[symphony] Failed to fetch issues:", e);
      }

      console.log(`[symphony] Found ${issues.length} candidate issues`);

      // 2. Reconcile: check running workers against Linear state
      const activeRuns: Record<string, { issueId: string; identifier: string; state: string }> = {};
      for (const [issueId, worker] of this.state) {
        if (worker.status === "running") {
          activeRuns[issueId] = { issueId, identifier: issueId, state: worker.status };
        }
      }

      const linearIssueIds = issues.map(i => ({ id: i.id, state: i.state }));
      const reconciliation = this.reconciler.reconcile(linearIssueIds, activeRuns);

      // Stop workers for terminal/deleted issues
      for (const issueId of reconciliation.toStop) {
        console.log(`[symphony] Stopping worker for ${issueId} (terminal/deleted)`);
        await this.stopWorker(issueId, workflow);
      }

      // Cleanup workspaces
      for (const issueId of reconciliation.toCleanup) {
        const worker = this.state.get(issueId);
        if (worker) {
          const workspacePath = `${this.config.workspaceRoot}/${worker.issueId}`;
          await runHook(this.hooks, "before_remove", workspacePath);
          try { this.workspaces.cleanup(worker.issueId); } catch {}
        }
        this.state.delete(issueId);
      }

      // 3. Process retry queue
      const retryEntry = this.retryQueue.next();
      if (retryEntry) {
        console.log(`[symphony] Retrying ${retryEntry.issueId} (attempt ${retryEntry.attempt})`);
        this.retryQueue.remove(retryEntry.issueId);
      }

      // 4. Dispatch new workers for candidate issues
      for (const issue of issues) {
        if (this.state.has(issue.id)) continue;
        if (this.state.size >= this.config.maxConcurrentWorkers) break;

        // Check if issue is in retry queue (waiting)
        const retries = this.retryQueue.list();
        if (retries.some(r => r.issueId === issue.id)) continue;

        console.log(`[symphony] Dispatching worker for ${issue.identifier}: ${issue.title}`);

        // Create workspace
        let workspace: string;
        try {
          workspace = this.workspaces.ensureWorkspace(issue.identifier);
        } catch (e) {
          console.error(`[symphony] Workspace error for ${issue.identifier}:`, e);
          this.retryQueue.add(issue.id, 1, "Workspace creation failed");
          continue;
        }

        // Run after_create hook
        await runHook(this.hooks, "after_create", workspace, {
          SYMPHONY_ISSUE_ID: issue.id,
          SYMPHONY_ISSUE_IDENTIFIER: issue.identifier,
        });

        // Update state to running
        this.state.set(issue.id, {
          issueId: issue.id,
          status: "running",
          sessionId: null,
          startedAt: new Date().toISOString(),
          lastHeartbeat: null,
        });

        // Build prompt with prompt builder
        const prompt = this.promptBuilder.build(
          {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description || undefined,
            state: issue.state,
          },
          {
            tools: ["linear_graphql"],
            states: Object.fromEntries(workflow.config.states.active.map(s => [s, s])),
          }
        );

        // Run before_run hook
        await runHook(this.hooks, "before_run", workspace, {
          SYMPHONY_ISSUE_ID: issue.id,
          SYMPHONY_PROMPT: prompt,
        });

        // Run agent
        const startTime = Date.now();
        try {
          const events = await this.agent.run(workspace, prompt, issue);
          console.log(`[symphony] Worker completed for ${issue.identifier}:`, events.length, "events");

          // Record tokens
          this.tokenAccountant.record(issue.id, `${issue.id}-${startTime}`, {});

          // Update state to completed
          const worker = this.state.get(issue.id);
          if (worker) {
            this.state.set(issue.id, { ...worker, status: "completed" });
          }

          // Run after_run hook
          await runHook(this.hooks, "after_run", workspace, {
            SYMPHONY_ISSUE_ID: issue.id,
            SYMPHONY_RUNTIME_MS: String(Date.now() - startTime),
          });
        } catch (error) {
          console.error(`[symphony] Agent failed for ${issue.identifier}:`, error);

          // Check retry policy
          const currentEntry = this.retryQueue.list().find(r => r.issueId === issue.id);
          const attempt = currentEntry ? currentEntry.attempt + 1 : 1;

          if (shouldRetry(attempt)) {
            console.log(`[symphony] Queueing retry for ${issue.identifier} (attempt ${attempt})`);
            this.retryQueue.add(issue.id, attempt, String(error));
            const worker = this.state.get(issue.id);
            if (worker) {
              this.state.set(issue.id, { ...worker, status: "failed" });
            }
          } else {
            console.log(`[symphony] Max retries reached for ${issue.identifier}, giving up`);
            await this.stopWorker(issue.id, workflow);
          }
        }
      }
    } catch (e) {
      console.error("[symphony] Tick error:", e);
    }
  }

  private async stopWorker(issueId: string, workflow: Workflow): Promise<void> {
    const worker = this.state.get(issueId);
    if (!worker) return;

    // Kill agent process if running
    try { this.agent.kill(issueId); } catch {}

    // Run before_remove hook
    const workspacePath = `${this.config.workspaceRoot}/${worker.issueId}`;
    await runHook(this.hooks, "before_remove", workspacePath);

    // Cleanup workspace
    try { this.workspaces.cleanup(worker.issueId); } catch {}

    // Remove from state
    this.state.delete(issueId);

    console.log(`[symphony] Worker stopped and cleaned up for ${issueId}`);
  }

  private buildSnapshot(): OrchestratorSnapshot {
    const running = Array.from(this.state.values())
      .filter(w => w.status === "running")
      .map(w => ({
        issueId: w.issueId,
        identifier: w.issueId,
        state: w.status,
        sessionId: w.sessionId || undefined,
        startedAt: w.startedAt,
        runtimeSeconds: Math.floor((Date.now() - new Date(w.startedAt).getTime()) / 1000),
        codexInputTokens: 0,
        codexOutputTokens: 0,
        codexTotalTokens: 0,
        turnCount: 0,
      }));

    const retrying = this.retryQueue.list().map(r => ({
      issueId: r.issueId,
      attempt: r.attempt,
      dueInMs: Math.max(0, r.dueAt - performance.now()),
    }));

    return {
      running,
      retrying,
      codexTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
      polling: {
        checking: true,
        nextPollInMs: this.config.pollIntervalMs,
        pollIntervalMs: this.config.pollIntervalMs,
      },
    };
  }

  getState(): Map<string, WorkerState> {
    return new Map(this.state);
  }
}
