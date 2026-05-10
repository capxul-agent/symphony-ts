# Symphony TypeScript — Product Requirements Document

## Purpose

This is our own PRD for the TypeScript/Bun implementation of Symphony. We are not building this for fun. We are building it because the Elixir reference implementation is hardcoded to Codex (OpenAI-only), and we need Kimi CLI support. The SPEC is language-agnostic; this PRD defines what our implementation must do to be conformant and useful.

## What the SPEC Actually Says (Not What We Invented)

### Agent Responsibility Boundary
The SPEC is explicit: **Symphony is a scheduler/runner and tracker reader. Ticket writes are performed by the coding agent using tools available in the workflow/runtime environment.** (Section 1, line 39-40)

This means:
- ✅ Symphony orchestrator: polls Linear, dispatches, manages workspaces, tracks state
- ✅ Agent (Kimi via bridge): writes code, uses git, creates PRs, updates Linear via `linear_graphql` tool
- ❌ Not Symphony's job: direct PR creation, direct Linear state mutation

### What the Elixir Reference Actually Implements

| Feature | Elixir Status | Notes |
|---------|--------------|-------|
| Workflow loader | ✅ | YAML front matter + prompt body |
| Config layer | ✅ | Typed getters, `$VAR` resolution |
| Dynamic reload | ✅ | File watcher re-reads WORKFLOW.md |
| Linear client | ✅ | GraphQL, pagination, blockers |
| Orchestrator | ✅ | Poll loop, dispatch, reconciliation |
| Workspace manager | ✅ | Per-issue dirs, sanitization, safety |
| Hooks | ✅ | after_create, before_run, after_run, before_remove |
| Agent runner | ✅ | Spawns Codex app-server |
| Codex app-server client | ✅ | JSON-RPC 2.0 over stdio |
| Token accounting | ✅ | Tracks input/output/total tokens |
| Retry/backoff | ✅ | Exponential backoff, continuation retries |
| Reconciliation | ✅ | Stall detection, state refresh, terminal cleanup |
| HTTP server | ✅ | Phoenix endpoint, dashboard, JSON API |
| Status dashboard | ✅ | LiveView dashboard at `/` |
| JSON API | ✅ | `/api/v1/state`, `/api/v1/<issue>`, `/api/v1/refresh` |
| `linear_graphql` tool | ✅ | Only client-side tool exposed to Codex |
| SSH workers | ✅ | Remote execution extension |
| Structured logging | ✅ | Required context fields |

### What the SPEC Says Is REQUIRED for Conformance (Section 18.1)

1. ✅ Workflow path selection
2. ✅ WORKFLOW.md loader with YAML front matter + prompt body
3. ✅ Typed config layer with defaults and `$` resolution
4. ✅ Dynamic WORKFLOW.md watch/reload/re-apply
5. ✅ Polling orchestrator with single-authority mutable state
6. ✅ Issue tracker client (candidate fetch + state refresh + terminal fetch)
7. ✅ Workspace manager with sanitized per-issue workspaces
8. ✅ Workspace lifecycle hooks (after_create, before_run, after_run, before_remove)
9. ✅ Hook timeout config (hooks.timeout_ms, default 60000)
10. ✅ Coding-agent app-server subprocess client with JSON line protocol
11. ✅ Codex launch command config (codex.command, default `codex app-server`)
12. ✅ Strict prompt rendering with `issue` and `attempt` variables
13. ✅ Exponential retry queue with continuation retries after normal exit
14. ✅ Configurable retry backoff cap (agent.max_retry_backoff_ms, default 5m)
15. ✅ Reconciliation that stops runs on terminal/non-active tracker states
16. ✅ Workspace cleanup for terminal issues (startup sweep + active transition)
17. ✅ Structured logs with issue_id, issue_identifier, and session_id
18. ✅ Operator-visible observability (structured logs; OPTIONAL snapshot/status surface)

### What the SPEC Says Is RECOMMENDED Extension (Section 18.2)

1. HTTP server extension (Section 13.7) — dashboard + JSON API
2. `linear_graphql` client-side tool extension
3. Persist retry queue across restarts (TODO in spec)
4. First-class tracker write APIs in orchestrator (TODO in spec)
5. Pluggable tracker adapters beyond Linear (TODO in spec)

## Our Implementation Status vs. SPEC

| SPEC Requirement | Our Status | Gap |
|------------------|-----------|-----|
| Workflow loader | ✅ | - |
| Config layer | ✅ | - |
| Dynamic reload | ❌ | No file watcher |
| Linear client | ✅ | - |
| Orchestrator | ⚠️ | No retry, no reconciliation, no stall detection |
| Workspace manager | ✅ | - |
| Hooks | ❌ | Not implemented |
| Agent runner | ✅ | - |
| App-server client | ✅ | Kimi CLI bridge instead of Codex |
| Token accounting | ❌ | Not implemented |
| Retry/backoff | ❌ | Not implemented |
| Reconciliation | ❌ | Not implemented |
| Structured logging | ⚠️ | Console only, no winston sinks |
| HTTP server | ❌ | Not implemented |
| Status dashboard | ❌ | Not implemented |
| JSON API | ❌ | Not implemented |
| `linear_graphql` tool | ❌ | Not exposed to Kimi |
| Prompt rendering | ✅ | - |
| Workspace cleanup | ❌ | No terminal cleanup |

## What We Must Build to Be Conformant

### Phase 1: Core Conformance (SPEC Section 18.1)

1. **Dynamic reload** — File watcher on WORKFLOW.md
2. **Retry queue** — Exponential backoff, continuation retries
3. **Reconciliation** — Stall detection, tracker state refresh, terminal cleanup
4. **Hooks** — after_create, before_run, after_run, before_remove with timeout
5. **Token accounting** — Track tokens from Kimi CLI output
6. **Workspace cleanup** — Startup terminal sweep + active transition cleanup
7. **Structured logging** — Winston with proper context fields

### Phase 2: Extensions (SPEC Section 18.2)

1. **HTTP server** — Bun.serve() with dashboard + JSON API
2. **`linear_graphql` tool** — Expose to Kimi via bridge
3. **Status dashboard** — Terminal or web UI

### Phase 3: Kimi-Specific (Not in SPEC, But Required for Our Use Case)

1. **Kimi CLI bridge** — Already done ✅
2. **Output parsing** — Clean TextPart extraction ✅
3. **Multi-turn sessions** — Kimi CLI doesn't support threads; simulate with stateful prompts

## The End-to-End Test We Need

### Current Smoke Test (What We Have)
1. Reset CAP-32 to Todo
2. Run orchestrator once
3. Verify: worker completed, file created in workspace

### Proper E2E Test (What We Need)
1. Create fresh test issue in Linear (or reset existing)
2. Start orchestrator daemon
3. Wait for poll cycle
4. Verify: issue picked up, workspace created, agent spawned
5. Verify: agent creates/updates files in workspace
6. Verify: agent moves issue to non-active state (via linear_graphql tool)
7. Verify: reconciliation stops worker, cleans workspace
8. Verify: retry queue empty, no re-dispatch

### The Test Should Prove
- Orchestrator polls correctly
- Workspace isolation works
- Agent executes in workspace
- Agent can mutate Linear (via tool)
- Reconciliation responds to state changes
- Cleanup happens for terminal issues

## Git/PR Creation — Agent's Job, Not Orchestrator's

The SPEC is clear: the orchestrator does not create PRs. The agent does. Our WORKFLOW.md prompt should instruct Kimi to:

1. Check git status
2. Create a branch
3. Make changes
4. Commit
5. Push
6. Open PR (if gh CLI available)
7. Update Linear issue state

The orchestrator's only job is to spawn the agent in the workspace with the prompt. The agent does the rest.

## Implementation Plan

### Immediate (This Week)
1. Add retry queue to orchestrator
2. Add reconciliation (stall detection + state refresh)
3. Add workspace cleanup for terminal issues
4. Add hooks support
5. Add token accounting from Kimi output

### Short Term (Next Week)
1. Add HTTP server with Bun.serve()
2. Add JSON API endpoints
3. Add `linear_graphql` tool to bridge
4. Add proper structured logging with Winston

### Medium Term
1. Terminal dashboard with Ink
2. Web dashboard (server-rendered HTML)
3. SSH worker extension
4. Persist retry queue across restarts

## Acceptance Criteria

- [ ] All SPEC Section 18.1 requirements implemented
- [ ] All SPEC Section 17 test cases pass
- [ ] Real integration profile passes with Linear + Kimi
- [ ] HTTP dashboard shows running sessions, retry queue, token totals
- [ ] Agent can update Linear issue states via `linear_graphql`
- [ ] Terminal issues trigger workspace cleanup
- [ ] Retry queue handles failures with exponential backoff
