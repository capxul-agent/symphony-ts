import { z } from "zod";

// ─── StringOrMap ────────────────────────────────────────────────────────────
// Elixir: StringOrMap Ecto.Type — accepts string or map

export const StringOrMapSchema = z.union([z.string(), z.record(z.string(), z.any())]);

// ─── Tracker ──────────────────────────────────────────────────────────────

export const TrackerSchema = z.object({
  kind: z.string(),
  endpoint: z.string().default("https://api.linear.app/graphql"),
  api_key: z.string().optional(),
  project_slug: z.string().optional(),
  assignee: z.string().optional(),
  active_states: z.array(z.string()).default(["Todo", "In Progress"]),
  terminal_states: z.array(z.string()).default(["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]),
});

export type TrackerConfig = z.infer<typeof TrackerSchema>;

// ─── Polling ────────────────────────────────────────────────────────────────

export const PollingSchema = z.object({
  interval_ms: z.number().int().positive().default(30_000),
});

export type PollingConfig = z.infer<typeof PollingSchema>;

// ─── Workspace ────────────────────────────────────────────────────────────

export const WorkspaceSchema = z.object({
  root: z.string().default("/tmp/symphony_workspaces"),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceSchema>;

// ─── Worker (SSH extension) ─────────────────────────────────────────────

export const WorkerSchema = z.object({
  ssh_hosts: z.array(z.string()).default([]),
  max_concurrent_agents_per_host: z.number().int().positive().optional(),
});

export type WorkerConfig = z.infer<typeof WorkerSchema>;

// ─── Agent ────────────────────────────────────────────────────────────────

export const AgentSchema = z.object({
  max_concurrent_agents: z.number().int().positive().default(10),
  max_turns: z.number().int().positive().default(20),
  max_retry_backoff_ms: z.number().int().positive().default(300_000),
  max_concurrent_agents_by_state: z.record(z.string(), z.number().int().positive()).default({}),
});

export type AgentConfig = z.infer<typeof AgentSchema>;

// ─── Codex ────────────────────────────────────────────────────────────────

export const CodexSchema = z.object({
  command: z.string().default("codex app-server"),
  approval_policy: StringOrMapSchema.default({
    reject: {
      sandbox_approval: true,
      rules: true,
      mcp_elicitations: true,
    },
  }),
  thread_sandbox: z.string().default("workspace-write"),
  turn_sandbox_policy: z.record(z.string(), z.any()).optional(),
  turn_timeout_ms: z.number().int().positive().default(3_600_000),
  read_timeout_ms: z.number().int().positive().default(5_000),
  stall_timeout_ms: z.number().int().nonnegative().default(300_000),
});

export type CodexConfig = z.infer<typeof CodexSchema>;

// ─── Hooks ────────────────────────────────────────────────────────────────

export const HooksSchema = z.object({
  after_create: z.string().optional(),
  before_run: z.string().optional(),
  after_run: z.string().optional(),
  before_remove: z.string().optional(),
  timeout_ms: z.number().int().positive().default(60_000),
});

export type HooksConfig = z.infer<typeof HooksSchema>;

// ─── Observability ────────────────────────────────────────────────────────

export const ObservabilitySchema = z.object({
  dashboard_enabled: z.boolean().default(true),
  refresh_ms: z.number().int().positive().default(1_000),
  render_interval_ms: z.number().int().positive().default(16),
});

export type ObservabilityConfig = z.infer<typeof ObservabilitySchema>;

// ─── Server ─────────────────────────────────────────────────────────────────

export const ServerSchema = z.object({
  port: z.number().int().nonnegative().optional(),
  host: z.string().default("127.0.0.1"),
});

export type ServerConfig = z.infer<typeof ServerSchema>;

// ─── Root Schema ────────────────────────────────────────────────────────────
// Use .optional() on nested objects so .default({}) works with empty input

export const ConfigSchema = z.object({
  tracker: TrackerSchema.optional().default({ kind: "", endpoint: "", active_states: [], terminal_states: [] }),
  polling: PollingSchema.optional().default({ interval_ms: 30_000 }),
  workspace: WorkspaceSchema.optional().default({ root: "/tmp/symphony_workspaces" }),
  worker: WorkerSchema.optional().default({ ssh_hosts: [] }),
  agent: AgentSchema.optional().default({ max_concurrent_agents: 10, max_turns: 20, max_retry_backoff_ms: 300_000, max_concurrent_agents_by_state: {} }),
  codex: CodexSchema.optional().default({ command: "codex app-server", approval_policy: {}, thread_sandbox: "", turn_timeout_ms: 0, read_timeout_ms: 0, stall_timeout_ms: 0 }),
  hooks: HooksSchema.optional().default({ timeout_ms: 60_000 }),
  observability: ObservabilitySchema.optional().default({ dashboard_enabled: true, refresh_ms: 1_000, render_interval_ms: 16 }),
  server: ServerSchema.optional().default({ host: "127.0.0.1" }),
});

export type SymphonyConfig = z.infer<typeof ConfigSchema>;

// ─── Resolution Helpers ─────────────────────────────────────────────────────

export function resolveEnvValue(value: string | undefined, fallback: string | undefined): string | undefined {
  if (!value) return fallback;
  if (value.startsWith("$")) {
    const envName = value.slice(1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) {
      const envValue = process.env[envName];
      if (envValue === undefined) return fallback;
      if (envValue === "") return undefined;
      return envValue;
    }
  }
  return value;
}

export function normalizeStateLimits(limits: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [stateName, limit] of Object.entries(limits)) {
    result[stateName.toLowerCase()] = limit;
  }
  return result;
}

export function normalizeSecretValue(value: string | undefined): string | undefined {
  if (!value || value === "") return undefined;
  return value;
}

export function resolvePathValue(value: string | undefined, defaultPath: string): string {
  if (!value) return defaultPath;
  const resolved = resolveEnvValue(value, defaultPath);
  if (!resolved || resolved === "") return defaultPath;
  if (resolved.startsWith("~")) {
    return resolved.replace("~", process.env.HOME || "/tmp");
  }
  return resolved;
}

export function defaultTurnSandboxPolicy(workspaceRoot: string): Record<string, unknown> {
  return {
    type: "workspaceWrite",
    writableRoots: [workspaceRoot],
    readOnlyAccess: { type: "fullAccess" },
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

// ─── Finalize Config (Elixir: finalize_settings/1) ──────────────────────────

export function finalizeConfig(raw: Record<string, unknown>): SymphonyConfig {
  const parsed = ConfigSchema.parse(raw);

  // Resolve secrets
  const tracker = {
    ...parsed.tracker,
    api_key: normalizeSecretValue(resolveEnvValue(parsed.tracker.api_key, process.env.LINEAR_API_KEY)),
    assignee: normalizeSecretValue(resolveEnvValue(parsed.tracker.assignee, process.env.LINEAR_ASSIGNEE)),
  };

  // Resolve workspace root
  const workspace = {
    ...parsed.workspace,
    root: resolvePathValue(parsed.workspace.root, "/tmp/symphony_workspaces"),
  };

  // Normalize codex policy keys
  const codex = {
    ...parsed.codex,
    approval_policy: normalizeKeys(parsed.codex.approval_policy) as string | Record<string, unknown>,
    turn_sandbox_policy: parsed.codex.turn_sandbox_policy
      ? normalizeKeys(parsed.codex.turn_sandbox_policy) as Record<string, unknown>
      : undefined,
  };

  // Normalize state limits
  const agent = {
    ...parsed.agent,
    max_concurrent_agents_by_state: normalizeStateLimits(parsed.agent.max_concurrent_agents_by_state),
  };

  return {
    ...parsed,
    tracker,
    workspace,
    codex,
    agent,
  };
}

function normalizeKeys(value: unknown): unknown {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key.toString()] = normalizeKeys(val);
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeKeys);
  }
  return value;
}
