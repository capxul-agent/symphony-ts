# Symphony TypeScript — Architecture & End-to-End Flow

## What This Is
A from-scratch TypeScript/Bun implementation of OpenAI's Symphony orchestrator spec. It polls Linear for issues, dispatches Kimi CLI as the coding agent, and manages per-issue workspaces.

## The Full Flow (How It Should Work)

### 1. Issue Lifecycle in Linear
- **Create**: Human creates issue in Linear (e.g., CAP-32: "Add user auth")
- **States**: Todo → In Progress → In Review → Done
- **Symphony watches**: Only `Todo` and `In Progress` are "active" states that trigger agent dispatch

### 2. Symphony Orchestrator (The Daemon)
```
Every 30s:
  1. Fetch candidate issues from Linear (active states)
  2. For each issue not already running:
     a. Create workspace: workspaces/CAP-32/
     b. Render prompt from WORKFLOW.md template + issue data
     c. Spawn Kimi CLI bridge (JSON-RPC over stdio)
     d. Agent executes: reads issue, writes code, creates PR
     e. Update Linear state (agent uses linear_graphql tool)
  3. Mark worker completed
```

### 3. The Agent's Job (Kimi via Bridge)
The prompt tells Kimi:
- What the issue is
- What files to create/modify
- To use git and create a PR
- To update Linear status when done

Kimi has access to:
- File system (workspace directory)
- Shell commands (git, etc.)
- Linear GraphQL API (via bridge tool)

### 4. Completion & Handoff
- Agent finishes work → creates PR → moves issue to "In Review"
- Symphony worker exits, state = completed
- Next poll: issue no longer in active state → not re-dispatched

## Current Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Linear polling | ✅ Working | Fetches issues, filters by state |
| Workspace creation | ✅ Working | Per-issue directories |
| Prompt rendering | ✅ Working | Template substitution |
| Kimi CLI bridge | ✅ Working | JSON-RPC over stdio |
| Agent execution | ✅ Working | Kimi creates files |
| State tracking | ✅ Working | Worker status: running → completed |
| **Git/PR creation** | ❌ Missing | Agent not configured to use git |
| **Linear state updates** | ❌ Missing | Agent doesn't call linear_graphql |
| **Retry/backoff** | ❌ Missing | No retry logic yet |
| **Reconciliation** | ❌ Missing | No stall detection |
| **HTTP dashboard** | ❌ Missing | No web UI |
| **Hooks** | ❌ Missing | No before_run/after_run |
| **Token accounting** | ❌ Missing | No usage tracking |

## What the Smoke Test Actually Tests

The current test (`bun test src/tests/smoke.test.ts`):
1. ✅ Finds CAP-32 in Linear (Todo state)
2. ✅ Creates workspace
3. ✅ Renders prompt
4. ✅ Spawns Kimi CLI via bridge
5. ✅ Kimi executes and creates a file
6. ✅ Marks worker as completed

What it does NOT test:
- ❌ Git operations (clone, branch, commit, push)
- ❌ PR creation
- ❌ Linear state transitions (Todo → In Progress → Done)
- ❌ Multi-turn sessions
- ❌ Retry on failure
- ❌ Workspace cleanup for terminal issues

## Next Steps for Full Implementation

1. **Git-aware workspace**: Clone target repo into workspace
2. **Enhanced prompt**: Include git workflow instructions
3. **linear_graphql tool**: Let agent update issue states
4. **Retry logic**: Exponential backoff on failures
5. **Reconciliation**: Detect stalled agents, terminal state cleanup
6. **HTTP server**: Dashboard at symphony.abuusama.dev
7. **Structured logging**: Winston with issue context
