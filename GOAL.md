# GOAL — Phase 2: Complete Symphony Orchestrator

> **Context:** This is a handoff prompt for `hermes goal`. You are continuing the port of OpenAI's Elixir Symphony orchestrator to TypeScript/Bun. Phase 1 (core loop + E2E smoke test) is DONE and passing. Your job is to implement the remaining modules to achieve full SPEC conformance.

## Current State

**Repo:** https://github.com/capxul-agent/symphony-ts  
**Branch:** main  
**Phase 1 Status:** ✅ COMPLETE — 4 E2E tests passing

### What Already Works (DO NOT TOUCH)

| Module | File | Status |
|--------|------|--------|
| Domain types | `src/domain.ts` | ✅ |
| Config schema | `src/config/schema.ts` | ✅ Zod validation |
| Workflow store | `src/workflow/store.ts` | ✅ File polling with Effect |
| Linear client | `src/linear.ts` | ✅ GraphQL, finds issues |
| Workspace manager | `src/workspace.ts` | ✅ Dir creation, git init |
| Kimi CLI bridge | `src/agent.ts` | ✅ JSON-RPC over stdio |
| Orchestrator loop | `src/orchestrator.ts` | ✅ Polls, dispatches, tracks |
| E2E test suite | `src/tests/e2e.test.ts` | ✅ 4/4 passing |

### Test Command (verify before you start)

```bash
cd ~/symphony-ts
bun test src/tests/e2e.test.ts --timeout 120000
# Expected: 4 pass, 0 fail
```

---

## What You Must Implement (Phase 2)

### 1. Retry Queue + Exponential Backoff (`src/scheduler/retry_queue.ts`)

**Elixir source:** `lib/symphony_elixir/scheduler.ex` (retry logic)  
**Pattern:** When an agent run fails (non-zero exit, crash, timeout), push to retry queue with exponential backoff (1s, 2s, 4s, 8s, max 60s). Max 5 retries, then mark issue as failed.

**Acceptance criteria:**
- [ ] `RetryQueue` module with `add(issueId, attemptCount)`, `next()`, `remove(issueId)`
- [ ] Backoff delays: `min(2^attempt * 1000, 60000)` ms
- [ ] After 5 failures, transition issue to terminal state (see #2)
- [ ] Test: `src/tests/retry_queue.test.ts` — simulate 5 failures, verify backoff timing, verify terminal transition

### 2. Reconciliation (`src/scheduler/reconciler.ts`)

**Elixir source:** `lib/symphony_elixir/tracker.ex` (state tracking)  
**Pattern:** On every poll, reconcile Linear state with local run state. If Linear issue is in a terminal state (Done, Canceled, Closed), stop any active run and clean up workspace.

**Acceptance criteria:**
- [ ] `Reconciler` module with `reconcile(linearIssues, activeRuns)`
- [ ] Detect terminal states from `WORKFLOW.md` state mapping
- [ ] For terminal issues: kill agent process, schedule workspace cleanup
- [ ] For deleted issues: same cleanup path
- [ ] Test: `src/tests/reconciler.test.ts` — mock Linear state changes, verify process kill + cleanup

### 3. Hooks System (`src/hooks.ts`)

**Elixir source:** `lib/symphony_elixir/hooks.ex`  
**Pattern:** Four hook points: `after_create`, `before_run`, `after_run`, `before_remove`. Each hook is a shell command executed in the workspace directory. Hooks can fail without breaking the main flow (log warning, continue).

**Acceptance criteria:**
- [ ] `Hooks` module with `execute(hookName, workspacePath, env)`
- [ ] Read hooks from `WORKFLOW.md` `hooks:` section
- [ ] Execute via `Bun.$` or `child_process.spawn`
- [ ] Non-zero exit = warning log, continue orchestration
- [ ] Test: `src/tests/hooks.test.ts` — mock WORKFLOW.md with hooks, verify execution + failure handling

### 4. Token Accounting (`src/tracker/token_accountant.ts`)

**Elixir source:** `lib/symphony_elixir/tracker.ex` (token tracking)  
**Pattern:** Parse Kimi CLI output for token usage lines (`TurnEnd(total_tokens=..., input_tokens=..., output_tokens=...)`). Accumulate per-issue, per-run, per-project. Write to `.symphony/tokens.jsonl`.

**Acceptance criteria:**
- [ ] `TokenAccountant` module with `record(issueId, runId, tokens)`
- [ ] Parse Kimi CLI `TurnEnd()` metadata for token counts
- [ ] Accumulate: per-run total, per-issue total, per-project total
- [ ] Append to `.symphony/tokens.jsonl` (JSON Lines format)
- [ ] Test: `src/tests/token_accountant.test.ts` — mock Kimi output, verify parsing + accumulation

### 5. HTTP Server + Dashboard + JSON API (`src/server.ts`)

**Elixir source:** `lib/symphony_web/` (Phoenix controllers, LiveView)  
**Pattern:** Bun.serve() on port from `SYMPHONY_PORT` env (default 8793). Three endpoints:

- `GET /` — HTML dashboard (static file from `public/index.html`)
- `GET /api/v1/state` — JSON: `{issues: [...], activeRuns: [...], stats: {...}}`
- `GET /api/v1/issues/:id` — JSON: single issue with run history
- `POST /api/v1/refresh` — Trigger immediate Linear poll

**Acceptance criteria:**
- [ ] `Server` module with `start(port)`, `stop()`
- [ ] Dashboard shows: active runs, queued issues, completed count, token usage
- [ ] API returns real data from orchestrator state (not mock)
- [ ] `POST /api/v1/refresh` triggers `orchestrator.pollNow()`
- [ ] Test: `src/tests/server.test.ts` — start server, hit all endpoints, verify JSON shape

### 6. `linear_graphql` Tool for Agents (`src/agent/tools/linear_graphql.ts`)

**Elixir source:** `lib/symphony_elixir/codex/dynamic_tool.ex`  
**Pattern:** Agent needs to call Linear GraphQL API. Provide a tool that the Kimi CLI bridge exposes: `linear_graphql(query, variables?)`. Bridge forwards to `src/linear.ts` client.

**Acceptance criteria:**
- [ ] Tool definition in bridge: `linear_graphql` with JSON schema
- [ ] Bridge handles `tool_call` JSON-RPC method, routes to Linear client
- [ ] Return GraphQL response as JSON string to agent
- [ ] Test: `src/tests/linear_tool.test.ts` — mock GraphQL query, verify tool execution + response

### 7. Prompt Builder with Liquid Templates (`src/prompt_builder.ts`)

**Elixir source:** `lib/symphony_elixir/codex/prompt_builder.ex`  
**Pattern:** Read `.symphony/prompt.md` from workspace. If it contains Liquid tags (`{{issue.title}}`, `{{issue.description}}`, `{{workflow.tools}}`), render with issue + workflow context. Fallback to raw prompt if no tags.

**Acceptance criteria:**
- [ ] `PromptBuilder` module with `build(issue, workflow)`
- [ ] Parse `prompt.md` for Liquid-style `{{var}}` tags
- [ ] Substitute: `issue.title`, `issue.description`, `issue.identifier`, `workflow.tools` (JSON array), `workflow.states` (JSON object)
- [ ] If no tags found, return raw prompt unchanged
- [ ] Test: `src/tests/prompt_builder.test.ts` — mock prompt.md with/without tags, verify substitution

---

## Implementation Order (Dependency Ranked)

1. **Retry Queue** — standalone, no deps
2. **Reconciler** — depends on retry queue (terminal state triggers cleanup)
3. **Hooks** — standalone, integrates into orchestrator
4. **Token Accountant** — standalone, integrates into agent bridge
5. **Prompt Builder** — standalone, integrates into agent
6. **Linear GraphQL Tool** — depends on Linear client (already exists)
7. **HTTP Server** — depends on orchestrator state

**Recommended:** Implement in order, test each before moving to next.

---

## Definition of Done (Phase 2 Complete)

### Mandatory Tests (all must pass)

```bash
# 1. Existing tests still pass
bun test src/tests/e2e.test.ts --timeout 120000
# Expected: 4 pass, 0 fail

# 2. New module tests
bun test src/tests/retry_queue.test.ts
bun test src/tests/reconciler.test.ts
bun test src/tests/hooks.test.ts
bun test src/tests/token_accountant.test.ts
bun test src/tests/server.test.ts
bun test src/tests/linear_tool.test.ts
bun test src/tests/prompt_builder.test.ts

# 3. Full suite
bun test
# Expected: 11+ pass, 0 fail
```

### End-to-End Ticket Flow (THE REAL TEST)

Create a Linear ticket and watch it go through ALL stages:

```bash
# Terminal 1: Start the orchestrator + server
bun run src/index.ts start --port 8793

# Terminal 2: Create a test issue in Linear
# (Use Linear UI or API — create issue in Capxul project with title "E2E Phase 2 Test")

# Terminal 3: Watch the flow
curl http://localhost:8793/api/v1/state
# Should show: issue in "Todo" state, queued

# Wait for orchestrator to pick it up (poll interval 30s, or hit refresh)
curl -X POST http://localhost:8793/api/v1/refresh

# Check state again — should show "In Progress" with activeRun
curl http://localhost:8793/api/v1/state

# Check workspace — should have files created by Kimi agent
ls workspaces/CAP-XX/.symphony/

# Check Linear — issue should move to "In Review" (agent did this via linear_graphql tool)

# Approve in Linear (move to "Done")
# Reconciler should detect terminal state, stop run, clean up

# Final check
curl http://localhost:8793/api/v1/issues/CAP-XX
# Should show: completed, token usage, run history, no activeRun
```

**Success criteria for E2E ticket flow:**
- [ ] Ticket created in Linear
- [ ] Orchestrator detects it within 1 poll cycle
- [ ] Workspace created with `after_create` hook executed
- [ ] Agent runs (`before_run` hook → Kimi CLI → `after_run` hook)
- [ ] Agent uses `linear_graphql` tool to move ticket to "In Review"
- [ ] Token usage recorded in `.symphony/tokens.jsonl`
- [ ] Dashboard shows real-time state at `/`
- [ ] JSON API returns accurate data
- [ ] Manual Linear state change to "Done" triggers reconciler cleanup
- [ ] `before_remove` hook executes, workspace archived

---

## Safety Invariants (DO NOT BREAK)

1. **Never redesign.** Translate Elixir patterns to TypeScript. If Elixir uses GenServer, use Effect. If Elixir uses Ecto changesets, use Zod.
2. **Bridge protocol is sacred.** JSON-RPC 2.0 over stdio. Methods: `initialize`, `thread/start`, `turn/start`, `tool_result`. No deviation.
3. **Kimi CLI only.** Do NOT use `api.kimi.com` — it returns 403 for non-agent clients. Always spawn `kimi --afk --print -p`.
4. **Effect for all async.** No raw Promises for orchestration logic. Use `Effect.gen`, `Effect.map`, `Effect.flatMap`, `Effect.catchAll`.
5. **Zod for all validation.** No runtime type assertions. Every external input parsed through Zod schema.
6. **Structured logging only.** Winston with JSON format. No `console.log` in production code.
7. **Tests before merge.** Every module has a `*.test.ts`. E2E test must pass before git push.

---

## Files to Reference

| File | Purpose |
|------|---------|
| `/opt/symphony/SPEC.md` | Original OpenAI specification (2169 lines) |
| `/opt/symphony/elixir/lib/symphony_elixir/` | Elixir reference implementation — THE SPEC |
| `src/domain.ts` | Domain types — DO NOT CHANGE without updating all consumers |
| `src/config/schema.ts` | Zod schemas — extend for new config fields |
| `src/linear.ts` | Linear client — use for `linear_graphql` tool |
| `src/agent.ts` | Kimi bridge — extend for tool handling |
| `src/orchestrator.ts` | Main loop — integrate retry queue, reconciler, hooks |
| `src/tests/e2e.test.ts` | Existing E2E — must still pass |

---

## Bridge Integration Points

**Where Kimi CLI plugs in:**

```
orchestrator.ts → agent.ts (spawn bridge)
                      ↓
               kimi_cli_bridge.py (JSON-RPC over stdio)
                      ↓
               kimi --afk --print -p (actual CLI)
                      ↓
               TextPart extraction (clean output)
                      ↓
               Return to orchestrator
```

**Tool call flow (NEW for Phase 2):**

```
Kimi CLI → outputs tool_call JSON
              ↓
       bridge parses tool_call
              ↓
       routes to linear_graphql handler
              ↓
       calls src/linear.ts client
              ↓
       returns result via tool_result JSON-RPC
              ↓
       bridge sends back to Kimi CLI
```

---

## Acceptance Criteria Summary

| # | Feature | Test File | E2E Verified |
|---|---------|-----------|------------|
| 1 | Retry queue | `retry_queue.test.ts` | ❌ |
| 2 | Reconciler | `reconciler.test.ts` | ❌ |
| 3 | Hooks | `hooks.test.ts` | ❌ |
| 4 | Token accounting | `token_accountant.test.ts` | ❌ |
| 5 | HTTP server + dashboard | `server.test.ts` | ❌ |
| 6 | linear_graphql tool | `linear_tool.test.ts` | ❌ |
| 7 | Prompt builder | `prompt_builder.test.ts` | ❌ |
| **All** | **Full ticket flow** | **Manual E2E** | **❌** |

**Phase 2 is DONE when:** All 7 module tests pass + full ticket E2E flow completes successfully + `bun test` shows 0 failures.
