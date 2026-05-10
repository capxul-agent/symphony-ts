# Symphony TypeScript — Hermes Goal Handoff Prompt

## Mission

Port the **Elixir reference implementation** of Symphony to **TypeScript/Bun** with **Effect** for async. Do not redesign. Do not simplify. Translate the proven architecture faithfully, module by module, preserving all behavior, edge cases, and safety invariants.

## Why We Are Building This

The Elixir implementation is hardcoded to Codex (OpenAI-only). We need Kimi CLI support. The SPEC is language-agnostic. The Elixir code is the source of truth for behavior. We port it to TypeScript so we can swap the agent backend.

## Elixir → TypeScript Module Mapping

| Elixir Module | TypeScript Module | Responsibility |
|---------------|-------------------|----------------|
| `SymphonyElixir` | `src/index.ts` | Application entry, supervisor startup |
| `SymphonyElixir.Application` | `src/app.ts` | OTP-style supervisor (Effect layers) |
| `SymphonyElixir.CLI` | `src/cli.ts` | Commander CLI, arg parsing, workflow path |
| `SymphonyElixir.Config` | `src/config.ts` | Runtime config, `settings!/0`, `validate!/0` |
| `SymphonyElixir.Config.Schema` | `src/config/schema.ts` | Ecto-style validation → Zod schemas |
| `SymphonyElixir.Workflow` | `src/workflow.ts` | Load WORKFLOW.md, split front matter/prompt |
| `SymphonyElixir.WorkflowStore` | `src/workflow/store.ts` | GenServer → Effect.Ref + polling loop |
| `SymphonyElixir.Tracker` | `src/tracker.ts` | Adapter boundary (behaviour → interface) |
| `SymphonyElixir.Linear.Adapter` | `src/linear/adapter.ts` | Linear tracker implementation |
| `SymphonyElixir.Linear.Client` | `src/linear/client.ts` | GraphQL client, pagination, queries |
| `SymphonyElixir.Linear.Issue` | `src/linear/issue.ts` | Issue struct + normalization |
| `SymphonyElixir.Orchestrator` | `src/orchestrator.ts` | **Core**: GenServer → Effect fiber with state machine |
| `SymphonyElixir.AgentRunner` | `src/agent.ts` | Workspace + prompt + app-server client |
| `SymphonyElixir.Workspace` | `src/workspace.ts` | Per-issue dirs, hooks, safety |
| `SymphonyElixir.PathSafety` | `src/path-safety.ts` | Canonicalization, root containment |
| `SymphonyElixir.PromptBuilder` | `src/prompt-builder.ts` | Liquid/Solid template rendering |
| `SymphonyElixir.Codex.AppServer` | `src/agent/app-server.ts` | JSON-RPC 2.0 over stdio |
| `SymphonyElixir.Codex.DynamicTool` | `src/agent/dynamic-tool.ts` | `linear_graphql` tool handler |
| `SymphonyElixir.HttpServer` | `src/http-server.ts` | Bun.serve() facade |
| `SymphonyElixir.StatusDashboard` | `src/dashboard.ts` | Terminal/web status surface |
| `SymphonyElixir.LogFile` | `src/logging.ts` | Structured logging with context |
| `SymphonyElixir.SSH` | `src/ssh.ts` | Remote worker extension |
| `SymphonyElixir.Tracker.Memory` | `src/tracker/memory.ts` | In-memory tracker for testing |

## Key Design Patterns to Preserve

### 1. Orchestrator State Machine (GenServer → Effect)

Elixir uses GenServer with `handle_info` for ticks, worker exits, retry timers, codex updates. In TypeScript:

```typescript
// Use Effect.gen with Ref for mutable state
// Use Effect.schedule for poll ticks
// Use Effect.fork for worker processes
// Use Queue for message passing (orchestrator ←→ workers)
```

**Must preserve:**
- `State` struct: `poll_interval_ms`, `max_concurrent_agents`, `running`, `claimed`, `retry_attempts`, `completed`, `codex_totals`, `codex_rate_limits`
- Tick sequence: reconcile → validate → fetch → dispatch
- Worker exit handling: normal → continuation retry (1s), abnormal → exponential backoff
- `{:DOWN, ref, :process, _pid, reason}` → find issue by ref, pop running entry, schedule retry
- `{:codex_worker_update, issue_id, update}` → integrate token deltas, rate limits
- `{:retry_issue, issue_id, token}` → pop retry, fetch candidates, re-dispatch or release

### 2. Config Layer (Ecto → Zod)

Elixir uses Ecto embedded schemas with changesets. In TypeScript:

```typescript
// Use Zod for schema validation
// Preserve all defaults exactly
// Preserve $VAR resolution, path expansion, secret normalization
// Preserve per-state concurrency limits normalization
```

**Schema structure (must match exactly):**
- `Tracker`: kind, endpoint, api_key, project_slug, assignee, active_states, terminal_states
- `Polling`: interval_ms (default 30000)
- `Workspace`: root (default `<tmp>/symphony_workspaces`)
- `Worker`: ssh_hosts, max_concurrent_agents_per_host
- `Agent`: max_concurrent_agents (10), max_turns (20), max_retry_backoff_ms (300000), max_concurrent_agents_by_state
- `Codex`: command (`codex app-server`), approval_policy, thread_sandbox, turn_sandbox_policy, turn_timeout_ms (3600000), read_timeout_ms (5000), stall_timeout_ms (300000)
- `Hooks`: after_create, before_run, after_run, before_remove, timeout_ms (60000)
- `Observability`: dashboard_enabled (true), refresh_ms (1000), render_interval_ms (16)
- `Server`: port, host (`127.0.0.1`)

### 3. Workflow Store (GenServer → Effect Fiber)

Elixir polls file mtime/size/hash every 1s. In TypeScript:

```typescript
// Effect.schedule(Schedule.spaced(1000)) to poll file stat
// Keep last known good workflow in Ref
// On change: reload, validate, update Ref
// On failure: log error, keep last known good
```

### 4. Workspace Manager

**Must preserve:**
- `create_for_issue/2` → returns `{ok, path} | {error, reason}`
- Sanitize identifier: `[A-Za-z0-9._-]` only, rest → `_`
- `ensure_workspace` → create if missing, reuse if exists, replace if file
- `validate_workspace_path` → must be under workspace root
- Hook execution: `bash -lc <script>` with cwd=workspace, timeout=hooks.timeout_ms
- Hook semantics: after_create (fatal), before_run (fatal), after_run (logged, ignored), before_remove (logged, ignored)
- SSH remote execution support (optional but preserve structure)

### 5. Agent Runner

**Must preserve:**
- `run/3` → starts worker, handles normal/abnormal exit
- `run_on_worker_host/4` → workspace → hooks → codex turns
- `run_codex_turns/5` → start session → loop turns → stop session
- `do_run_codex_turns/7` → build prompt → run turn → check issue state → continue or break
- Max turns enforcement
- Issue state refresh between turns
- Session reuse across continuation turns

### 6. App-Server Client (Codex JSON-RPC)

**Must preserve:**
- `start_session/2` → spawn port, initialize, get thread_id
- `run_turn/4` → send turn/start, stream updates, wait completion
- `stop_session/1` → terminate port
- Message IDs: initialize=1, thread_start=2, turn_start=3
- Read timeout: 5000ms for sync requests
- Turn timeout: 3600000ms
- Dynamic tool handling: `linear_graphql` only
- Auto-approve policy for non-interactive sessions
- Token accounting from protocol events

### 7. Linear Client

**Must preserve:**
- `fetch_candidate_issues/0` → paginated query with project slug + active states
- `fetch_issues_by_states/1` → for startup terminal cleanup
- `fetch_issue_states_by_ids/1` → for reconciliation
- `graphql/3` → raw GraphQL with auth header
- Issue normalization: labels lowercase, blockers from inverseRelations type=blocks, priority integer only
- Page size: 50
- Network timeout: 30000ms

### 8. HTTP Server Extension

**Must preserve:**
- `Bun.serve()` instead of Phoenix
- Dashboard at `/` (server-rendered HTML or client-side)
- JSON API:
  - `GET /api/v1/state` → running, retrying, codex_totals, rate_limits
  - `GET /api/v1/:issue_identifier` → issue-specific details
  - `POST /api/v1/refresh` → trigger poll cycle
- PubSub for live updates (or polling from dashboard)

## Critical Safety Invariants (Must Not Break)

1. **Workspace containment**: `workspace_path` MUST have `workspace_root` as prefix
2. **Agent cwd**: subprocess cwd MUST be workspace_path
3. **Identifier sanitization**: only `[A-Za-z0-9._-]` in directory names
4. **Hook timeout**: all hooks MUST have timeout to prevent hangs
5. **Token accounting**: track deltas, not cumulative, avoid double-counting
6. **Retry idempotency**: claimed + running checks before ANY dispatch
7. **Stall detection**: kill worker if no events for `stall_timeout_ms`

## Kimi CLI Bridge Integration

The Elixir code spawns `codex app-server` via Port. We replace this with our Python bridge:

```typescript
// codex.command = "python3 /opt/symphony/kimi_cli_bridge.py"
// The bridge speaks the same JSON-RPC 2.0 protocol
// AgentRunner calls AppServer.start_session() → spawns bridge instead of codex
// All other code remains identical
```

**Bridge location**: `/opt/symphony/kimi_cli_bridge.py`
**Bridge protocol**: JSON-RPC 2.0 over stdio (same as Codex app-server)

## Testing Strategy

1. **Unit tests** for each module (mirror Elixir test structure)
2. **Integration tests** with `Tracker.Memory` (in-memory tracker)
3. **Real integration profile** with Linear + Kimi CLI
4. **Smoke test**: Create issue → poll → dispatch → execute → verify workspace

## Files to Create

```
src/
  index.ts              # Application entry
  app.ts                # Supervisor/layer composition
  cli.ts                # Commander CLI
  config.ts             # Config access
  config/
    schema.ts           # Zod schemas (mirror Ecto)
  workflow.ts           # Workflow loader
  workflow/
    store.ts            # File watcher + cache
  tracker.ts            # Adapter interface
  tracker/
    memory.ts           # In-memory adapter for tests
  linear/
    adapter.ts          # Linear tracker adapter
    client.ts           # GraphQL client
    issue.ts            # Issue struct + normalization
  orchestrator.ts       # Core state machine
  agent.ts              # Agent runner
  agent/
    app-server.ts       # JSON-RPC client
    dynamic-tool.ts     # linear_graphql handler
  workspace.ts          # Workspace manager
  path-safety.ts        # Path canonicalization
  prompt-builder.ts     # Template rendering
  http-server.ts        # Bun.serve() facade
  dashboard.ts          # Status surface
  logging.ts            # Structured logging
  ssh.ts                # Remote worker extension
```

## Acceptance Criteria

- [ ] All Elixir modules have TypeScript equivalents
- [ ] All SPEC Section 18.1 requirements implemented
- [ ] Orchestrator state machine matches Elixir behavior exactly
- [ ] Config validation matches Ecto changeset semantics
- [ ] Workspace safety invariants enforced
- [ ] Hooks execute with correct failure semantics
- [ ] Retry queue with exponential backoff works
- [ ] Reconciliation stops runs on terminal states
- [ ] Token accounting tracks usage correctly
- [ ] HTTP server serves dashboard + JSON API
- [ ] Smoke test passes end-to-end with Kimi CLI
- [ ] Real integration test passes with Linear

## Current State

- Repo: https://github.com/capxul-agent/symphony-ts
- Basic modules exist but are incomplete
- Orchestrator lacks retry, reconciliation, hooks
- No HTTP server, no dashboard, no token accounting
- Smoke test passes basic poll → dispatch → execute

## Next Action

Implement modules in dependency order:
1. `config/schema.ts` (Zod schemas)
2. `workflow/store.ts` (file watcher)
3. `orchestrator.ts` (full state machine)
4. `workspace.ts` (hooks + safety)
5. `agent/app-server.ts` (bridge integration)
6. `http-server.ts` + `dashboard.ts`
7. Tests for each module
