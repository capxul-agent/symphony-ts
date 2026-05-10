# Symphony-TS Completion Prompt

## Objective
Complete the TypeScript/Bun Symphony orchestrator to full SPEC.md conformance, including: retry queue, reconciliation, hooks, cleanup, token accounting, HTTP server, dashboard, JSON API, `linear_graphql` tool, and the full closed-loop workflow (PR → review → merge → cleanup).

## Current State
- Repository: `https://github.com/capxul-agent/symphony-ts`
- Location: `~/symphony-ts` (or clone from GitHub)
- Runtime: Bun (NOT Node.js — see `CLAUDE.md` in repo)
- Agent: Kimi CLI via `kimi --afk --print -p` (NOT API — API returns 403 for non-agents)
- Linear Project ID: `8e254c24eebe` (Capxul project)
- Linear API Key: Stored in `.env` as `LINEAR_API_KEY` (Bun auto-loads `.env`, no dotenv needed)
- Cloudflare tunnel: `hermes-gateway` (add `symphony.abuusama.dev` → `localhost:8793`)

## Already Implemented (DO NOT REWRITE)
- `src/domain.ts` — Domain types
- `src/workflow.ts` — YAML workflow parser
- `src/linear.ts` — GraphQL Linear client
- `src/workspace.ts` — Workspace directory management
- `src/agent.ts` — Kimi CLI bridge (JSON-RPC over stdio)
- `src/orchestrator.ts` — Main orchestrator loop (basic)
- `src/index.ts` — CLI entry point
- `src/scheduler/retry_queue.ts` — In-memory retry queue
- `src/scheduler/reconciler.ts` — Reconciliation loop
- `src/hooks.ts` — Hook execution (before_start, after_create, on_complete)
- `src/tokens.ts` — Token usage tracking
- `src/server.ts` — Bun.serve HTTP server + dashboard
- `src/dashboard.ts` — Dashboard HTML (auto-refreshing)
- `src/api.ts` — JSON API endpoints (/api/v1/state, /api/v1/:issue, /api/v1/refresh)
- `src/linear_tool.ts` — `linear_graphql` tool for agent
- `src/prompts.ts` — Prompt builder with template engine
- `src/tests/smoke.test.ts` — Smoke test (passes)
- `test_e2e.ts`, `test_full.ts` — E2E tests

## What Needs to Be Done

### 1. systemd Service
Create `/etc/systemd/system/symphony-ts.service`:
```ini
[Unit]
Description=Symphony TypeScript Orchestrator
After=network.target

[Service]
Type=simple
User=abuusama
WorkingDirectory=/home/abuusama/symphony-ts
EnvironmentFile=/home/abuusama/symphony-ts/.env
ExecStart=/usr/bin/node dist/index.js start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Enable and start: `sudo systemctl enable --now symphony-ts`

### 2. Cloudflare Tunnel Routing
Add to `~/.cloudflared/config.yml`:
```yaml
ingress:
  - hostname: symphony.abuusama.dev
    service: http://localhost:8793
  # ... existing routes ...
```
Reload: `cloudflared tunnel route dns hermes-gateway symphony.abuusama.dev`

### 3. Full Closed-Loop Workflow
The orchestrator must handle the COMPLETE ticket lifecycle:

```
Linear Issue (Todo) 
  → Orchestrator picks up 
  → Agent: create branch, implement, commit, push 
  → Agent: create PR via `gh` CLI 
  → Agent: update Linear to "In Review" 
  → Orchestrator: detect PR created, assign reviewer (Abu or capxul-agent) 
  → [WAIT for review approval] 
  → Orchestrator: detect PR merged 
  → Agent: update Linear to "Done" 
  → Orchestrator: cleanup workspace
```

**Key additions needed:**
- **PR Review Assignment**: When agent creates PR, orchestrator must assign reviewer via GitHub API
- **Review Polling**: Poll GitHub PR status (merged/closed) — NOT just Linear state
- **Merge Detection**: Use `gh pr view` or GitHub API to check merge status
- **Post-Merge Cleanup**: Delete branch, archive workspace, update Linear to "Done"
- **Error Handling**: If PR rejected/closed, update Linear to "Canceled" or retry

### 4. Agent Tooling Expansion
The agent needs these tools exposed via `linear_graphql` and shell:
- `gh pr create --title "..." --body "..." --base main` — Create PR
- `gh pr view <url> --json state,merged` — Check PR status
- `gh pr merge <url> --squash` — Merge PR (or let reviewer do it)
- `linear_graphql` mutation to update issue state → "In Review", "Done", "Canceled"
- Git commands: `git checkout -b`, `git add`, `git commit`, `git push`

### 5. Orchestrator State Machine
Enhance `src/orchestrator.ts` with proper state machine:
```
States: idle → running → reviewing → merging → done → cleanup
        ↓         ↓          ↓         ↓        ↓
      retry   retry      wait      wait    archive
```

### 6. Token Accounting & Limits
- Track per-session and total token usage
- Enforce `max_tokens` limit from WORKFLOW.md
- Log token usage to dashboard
- Alert when approaching limits

### 7. Structured Logging
- Use Winston or similar for JSON-structured logs
- Log levels: debug, info, warn, error
- Log to file + console
- Include correlation IDs (issue IDs)

### 8. Testing
- Unit tests for each module
- E2E test for full ticket lifecycle (use a dummy issue)
- Mock Linear/GitHub APIs for tests

## SPEC.md Key Requirements (from `/opt/symphony/SPEC.md`)
- Orchestrator = scheduler + runner + tracker ONLY
- Agent does ALL git/Linear/PR work via tools
- JSON-RPC 2.0 over stdio with newline-delimited messages
- Retry with exponential backoff (base 2, max 5 attempts)
- Reconciliation: detect orphaned processes, stale states
- Cleanup: remove workspace directories after completion
- Hooks: before_start, after_create, on_complete
- HTTP server: dashboard + JSON API
- `linear_graphql` tool: ONLY client-side tool exposed to agent

## Definition of Done
- [ ] systemd service running and auto-starting on boot
- [ ] `symphony.abuusama.dev` accessible via Cloudflare tunnel
- [ ] Dashboard shows real-time state with auto-refresh
- [ ] Full ticket lifecycle works end-to-end: pickup → branch → code → PR → review → merge → cleanup
- [ ] Linear states update correctly through lifecycle
- [ ] PR reviewer auto-assigned
- [ ] Token usage tracked and displayed
- [ ] All tests pass
- [ ] No Elixir dependency — pure TypeScript/Node.js

## Commands to Run
```bash
# Setup
cd ~/symphony-ts
bun install
bun run build

# Test
bun test

# Deploy
sudo systemctl enable --now symphony-ts

# Verify
curl http://symphony.abuusama.dev/api/v1/state
curl http://localhost:8793/api/v1/state
```

## Important Notes
- **Kimi CLI only** — do NOT use Kimi API (returns 403)
- **Bridge protocol**: JSON-RPC 2.0 over stdio, newline-delimited
- **Linear project slug**: `8e254c24eebe`
- **GitHub bot**: `capxul-agent` — use this account for PRs
- **Reviewer**: Assign `aaronabuusama` or `capxul-agent` for review
- **Environment**: `.env` file with `LINEAR_API_KEY`, `LINEAR_PROJECT_SLUG`
- **Working directory**: `/home/abuusama/symphony-ts`
