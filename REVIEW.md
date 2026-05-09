# Symphony TypeScript/Bun Implementation Plan — Technical Review

**Reviewer:** Senior Technical Reviewer (Hermes Agent)
**Date:** 2026-05-09
**Plan:** `/home/abuusama/symphony-ts/PLAN.md`
**SPEC:** https://raw.githubusercontent.com/openai/symphony/main/SPEC.md

---

## Overall Verdict: **Approve with Changes**

The plan captures the high-level architecture and major subsystems, but it has **critical gaps** against the SPEC that will cause non-conformance if implemented as written. The plan is a reasonable skeleton, but several SPEC-mandated behaviors are missing, partially implemented, or incorrectly specified.

---

## Critical Gaps (Must Fix Before Implementation)

### 1. **Missing YAML Parser Dependency & Implementation**
- **Location:** Task 3, `src/workflow/loader.ts`
- **Issue:** The workflow loader has a `parseYamlFrontMatter` stub marked `TODO` and no `yaml` dependency is installed in Task 1.
- **SPEC Requirement:** Section 5.2 — front matter parsing is REQUIRED. Section 18.1 — dynamic reload is REQUIRED.
- **Fix:** Add `js-yaml` or `yaml` to dependencies in Task 1. Implement actual YAML parsing. Implement file watching (e.g., `fs.watch` or `chokidar`) for dynamic reload per Section 6.2.

### 2. **No Template Engine Specified**
- **Location:** Task 3, `src/workflow/loader.ts` / Task 7, `src/agent/runner.ts`
- **Issue:** Prompt template rendering is a `TODO` stub with no engine chosen.
- **SPEC Requirement:** Section 5.4 — strict template engine (Liquid-compatible), unknown variables/filters MUST fail rendering. Section 12 — `issue` and `attempt` variables must be supported.
- **Fix:** Add `liquidjs` or `handlebars` (with strict mode) to dependencies. Implement `renderPrompt(template, issue, attempt)` with strict variable checking.

### 3. **Incomplete Linear Client Implementation**
- **Location:** Task 4, `src/tracker/linear.ts`
- **Issue:** `fetchIssuesByStates` and `fetchIssueStatesByIds` are `TODO` stubs. No pagination. No blocker normalization. No error mapping.
- **SPEC Requirement:** Section 11.1 — all three operations REQUIRED. Section 11.2 — pagination REQUIRED (page size 50). Section 11.3 — blocker normalization, label lowercase, ISO timestamp parsing. Section 11.4 — error categories.
- **Fix:** Implement full GraphQL queries with pagination (`hasNextPage`/`endCursor`). Implement `blocked_by` from inverse `blocks` relations. Add `Issue` fields: `branch_name`, `blocked_by`. Add error mapping categories.

### 4. **Missing Workspace Hooks & Safety Invariants**
- **Location:** Task 5, `src/workspace/manager.ts`
- **Issue:** No hook execution (`after_create`, `before_run`, `after_run`, `before_remove`). No path containment validation. No `created_now` tracking.
- **SPEC Requirement:** Section 9.2 — `created_now` flag. Section 9.4 — hooks with timeout. Section 9.5 — Invariant 2 (path containment). Section 18.1 — hooks and timeout REQUIRED.
- **Fix:** Add hook runner with `sh -lc` execution and configurable timeout. Validate `workspace_path` is a prefix of `workspace_root` before agent launch.

### 5. **Incomplete JSON-RPC / App-Server Client**
- **Location:** Task 6, `src/agent/jsonrpc.ts`
- **Issue:** `handleData` is a `TODO` stub. No newline-delimited JSON buffering. No stderr separation. No event emission for streaming updates.
- **SPEC Requirement:** Section 10.3 — transport/framing rules. Section 10.1 — max line size 10MB. Section 10.5 — approval/tool handling. Section 10.4 — structured events upstream.
- **Fix:** Implement a proper NDJSON buffer with 10MB line limit. Separate stderr from protocol stream. Emit all required events (`session_started`, `turn_completed`, `turn_failed`, etc.).

### 6. **Missing Orchestrator State Machine & Retry Logic**
- **Location:** Task 8, `src/orchestrator/engine.ts`
- **Issue:** No `claimed` set. No retry queue. No exponential backoff. No continuation retry (1s). No stall detection. No reconciliation (state refresh). No per-state concurrency. No startup terminal cleanup. No `max_turns` handling.
- **SPEC Requirement:** Section 7 — full state machine. Section 8.2 — candidate selection with blocker rules. Section 8.4 — retry/backoff. Section 8.5 — reconciliation. Section 8.6 — startup cleanup. Section 16 — reference algorithms.
- **Fix:** Implement full orchestrator state per Section 16. Add `claimed`, `retry_attempts`, `completed`. Implement `reconcile_running_issues` with stall detection and tracker refresh. Implement dispatch sorting (priority, created_at, identifier). Implement `Todo` blocker check. Implement retry scheduling with `1000ms` continuation and `10s * 2^(attempt-1)` backoff.

### 7. **No Token Accounting / Session Metrics**
- **Location:** Task 6-8
- **Issue:** No tracking of `codex_input_tokens`, `codex_output_tokens`, `turn_count`, `last_codex_event`, etc.
- **SPEC Requirement:** Section 4.1.6 — Live Session fields. Section 13.5 — token accounting with delta tracking. Section 13.3 — snapshot interface.
- **Fix:** Add `LiveSession` type to orchestrator state. Track token deltas from `thread/tokenUsage/updated` events. Maintain `codex_totals` aggregate.

### 8. **Missing Config Layer & Dynamic Reload**
- **Location:** Task 3, `src/config/settings.ts`
- **Issue:** `settings.ts` is referenced but not shown. No typed config getters. No `$VAR` resolution. No `~` expansion. No dynamic reload.
- **SPEC Requirement:** Section 6 — full config resolution pipeline. Section 6.2 — dynamic reload REQUIRED. Section 18.1 — typed config layer REQUIRED.
- **Fix:** Implement `Settings` class with typed getters, default application, `$VAR` indirection, path expansion, and hot-reload via workflow file watcher.

### 9. **CLI Missing Workflow Path Argument**
- **Location:** Task 2 / Task 10, `src/index.ts`
- **Issue:** CLI does not accept a positional workflow path argument. Defaults to cwd but doesn't error on missing `WORKFLOW.md`.
- **SPEC Requirement:** Section 17.7 — CLI accepts positional workflow path. Section 17.7 — errors on nonexistent path or missing default.
- **Fix:** Add `[workflow-path]` positional argument to CLI. Validate file exists before startup.

### 10. **No `linear_graphql` Client-Side Tool Extension**
- **Location:** Task 12 (Kimi bridge)
- **Issue:** The Kimi bridge task suggests skipping JSON-RPC entirely, which breaks the app-server protocol contract.
- **SPEC Requirement:** Section 10.5 — if client-side tools are implemented, advertise them. Section 18.2 — `linear_graphql` extension RECOMMENDED.
- **Fix:** If implementing Kimi direct API, still need to handle tool execution in TypeScript. Alternatively, implement a local stdio bridge that speaks the Codex app-server protocol to the orchestrator while using Kimi API underneath. The `linear_graphql` tool should be implemented as a pass-through to the configured Linear client.

---

## Recommendations (Should Fix)

### R1. **Replace `node-pty` with `child_process` for Agent Subprocess**
- `node-pty` is a native dependency that may complicate Bun compatibility. The SPEC only requires `bash -lc <command>` in the workspace directory. `Bun.spawn()` or Node's `spawn` with `stdio: 'pipe'` is sufficient and more portable.
- If PTY is needed for TUI reasons, document it explicitly.

### R2. **Add `blocked_by` to Issue Type**
- The `Issue` interface in Task 4 is missing `branch_name` and `blocked_by` fields required by Section 4.1.1.

### R3. **Implement Proper Error Types**
- The plan uses generic `Error` and `console.error`. The SPEC defines typed error categories (Section 5.5, 10.6, 11.4, 14.1). Implement an `OrchestratorError` hierarchy.

### R4. **Add `attempt` to Worker / AgentRunner**
- The `Worker.run` signature in Task 8 does not pass `attempt` to the agent runner, which is needed for retry/continuation prompt rendering per Section 12.3.

### R5. **Dashboard State Access Race Condition**
- Task 10 calls `orchestrator.getState()` but `Orchestrator` in Task 8 does not implement `getState()`. The dashboard needs a reactive state stream, not a one-time snapshot.
- **Fix:** Implement an event emitter or observable state pattern on the orchestrator.

### R6. **Missing `before_run` / `after_run` Hook Integration**
- The agent runner in Task 7 does not call workspace hooks. Hooks must be integrated into the run attempt lifecycle per Section 16.5.

### R7. **No HTTP Server Extension**
- The SPEC Section 13.7 defines an OPTIONAL but RECOMMENDED HTTP server with `/api/v1/state`, `/api/v1/<issue_identifier>`, and `POST /api/v1/refresh`. The plan only has a terminal TUI. Consider adding a lightweight HTTP server (e.g., `Bun.serve()`) as a Phase 6 task.

### R8. **Task Granularity Too Coarse for Subagent Execution**
- Tasks 6-8 each contain multiple subsystems that could fail independently. For subagent-driven development, split into smaller tasks:
  - Task 6a: JSON-RPC transport (NDJSON buffer, request/response matching)
  - Task 6b: App-server event emitter (turn events, token tracking)
  - Task 7a: Agent runner (workspace + prompt + hooks)
  - Task 7b: Session lifecycle (initialize, thread/start, turn/start, continuation)
  - Task 8a: Orchestrator state machine (claimed, running, retry)
  - Task 8b: Reconciliation and stall detection
  - Task 8c: Dispatch logic (sorting, blocker checks, slot limits)

### R9. **Add `zod` schema for Workflow Config**
- The `WorkflowConfig` interface in Task 3 should have a corresponding Zod schema for runtime validation, matching the SPEC's strict validation requirements.

### R10. **Security: Path Traversal in Workspace Manager**
- The current sanitizer only replaces invalid chars but does not prevent `../` in identifiers (though Linear identifiers are usually safe). Add an explicit check that the resolved workspace path is under the root.

---

## Questions for the Author

1. **Why `node-pty` instead of `Bun.spawn` or `child_process`?** The SPEC requires `bash -lc` in the workspace directory, which does not need a PTY. Native PTY dependencies increase build complexity.

2. **Is the Kimi bridge intended to replace the Codex app-server protocol entirely?** If so, how will tool calls, approval policies, and session threading be handled? The SPEC Section 10 requires following the targeted app-server protocol.

3. **What is the plan for testing?** The SPEC Section 17 defines a comprehensive test matrix (Core Conformance, Extension Conformance, Real Integration). No test tasks or test infrastructure are mentioned in the plan.

4. **How will the dashboard receive live state updates?** The current plan passes state at startup, but the orchestrator mutates state asynchronously. Is there an event bus planned?

5. **Why is `graphql-request` chosen over a lighter fetch-based client?** Linear pagination requires cursor handling that `graphql-request` does not provide out-of-the-box. Would a custom fetch client with pagination loops be clearer?

6. **What is the intended deployment model?** The plan uses `/opt/symphony-ts` as a hardcoded path. Is this meant to be a system service, a user binary, or a containerized app?

---

## Summary Table

| Category | Count | Items |
|----------|-------|-------|
| Critical Gaps | 10 | YAML parser, template engine, Linear client completeness, workspace hooks/safety, JSON-RPC transport, orchestrator state machine, token accounting, config layer, CLI workflow path, client-side tools |
| Recommendations | 10 | PTY vs spawn, Issue fields, error types, attempt passing, dashboard state, hook integration, HTTP server, task granularity, Zod schema, path traversal |
| Questions | 6 | PTY choice, Kimi protocol, testing plan, dashboard updates, GraphQL client, deployment model |

---

## Conclusion

The plan is a **good starting skeleton** but is currently **non-conforming** to the Symphony SPEC in its current form. The biggest risks are:

1. **Orchestrator incompleteness** — missing retry logic, reconciliation, stall detection, and startup cleanup will make the system unusable for real workloads.
2. **Agent protocol incompleteness** — the JSON-RPC client is a stub with no NDJSON handling, which will break Codex integration immediately.
3. **No dynamic reload** — a SPEC-required feature that is completely absent.

**Recommendation:** Update the plan to address the 10 critical gaps before task execution begins. Split Tasks 6-8 into smaller, independently verifiable sub-tasks for subagent development. Add a testing phase (Task 13+) covering the Section 17 validation matrix.
