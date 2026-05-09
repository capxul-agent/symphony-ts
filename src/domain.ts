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
  readonly blockedBy: ReadonlyArray<{
    readonly id: string | null;
    readonly identifier: string | null;
    readonly state: string | null;
  }>;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface WorkflowConfig {
  readonly tracker: {
    readonly kind: "linear";
    readonly projectSlug: string;
  };
  readonly states: {
    readonly active: ReadonlyArray<string>;
    readonly terminal: ReadonlyArray<string>;
  };
  readonly codex: {
    readonly command: string;
    readonly readTimeoutMs: number;
    readonly turnTimeoutMs: number;
    readonly stallTimeoutMs: number;
  };
  readonly workspace: {
    readonly root: string;
  };
  readonly hooks?: {
    readonly preRun?: string;
    readonly postRun?: string;
  };
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

export interface OrchestratorState {
  readonly workers: ReadonlyMap<string, WorkerState>;
  readonly lastPollTime: string | null;
}

// ─── JSON-RPC Types ─────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export interface Session {
  readonly threadId: string;
  readonly turnId: string | null;
  readonly workspace: string;
}

// ─── Agent Events ───────────────────────────────────────────────────────────

export interface AgentEvent {
  readonly event: string;
  readonly timestamp: string;
  readonly sessionId: string | null;
  readonly payload: unknown | null;
}

// ─── Config ─────────────────────────────────────────────────────────────────

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

export const makeConfig = (): AppConfig => ({
  linearApiKey: process.env.LINEAR_API_KEY || "",
  linearProjectSlug: process.env.LINEAR_PROJECT_SLUG || "symphony",
  workspaceRoot: process.env.WORKSPACE_ROOT || "/opt/symphony-ts/workspaces",
  codexCommand: process.env.CODEX_COMMAND || "python3 /opt/symphony/kimi_cli_bridge.py",
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 30000,
  maxConcurrentWorkers: Number(process.env.MAX_CONCURRENT_WORKERS) || 3,
  turnTimeoutMs: Number(process.env.TURN_TIMEOUT_MS) || 300000,
  dashboardPort: Number(process.env.DASHBOARD_PORT) || 8793,
});
