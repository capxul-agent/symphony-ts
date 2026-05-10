# Symphony-TS Phase 3: Real Project Integration

## Goal
Wire the TypeScript/Bun Symphony orchestrator to work with real Capxul issues through the complete lifecycle: issue pickup → branch creation → implementation → PR creation → Linear state management → human review → merge.

## Background

The orchestrator core is built (scheduler, retry queue, hooks, token accounting, prompt builder, Linear client, HTTP server). The Kimi CLI bridge successfully executes turns. Now we need to make it work for actual project work, not just smoke tests.

## Key Research Finding

**The orchestrator does NOT directly manage git branches or PRs. The agent does.**

From the SPEC and Elixir reference:
- The `after_create` hook clones the target repo into the workspace
- The agent (Codex/Kimi) creates branches, makes commits, pushes, creates PRs
- The agent uses the `linear_graphql` tool to update Linear states
- The orchestrator only WATCHES Linear — when a human moves an issue to terminal state, the orchestrator stops the agent and cleans up

## Required Changes

### 1. Fix WORKFLOW.md for Capxul Project

Current WORKFLOW.md targets `github.com/openai/symphony`. Change to:
- Clone Capxul repo (or whichever repo the issue belongs to)
- Set up git identity
- Configure GitHub CLI auth

### 2. Enhance Kimi Bridge with `linear_graphql` Tool

The bridge must advertise the `linear_graphql` tool during session initialization. When Kimi calls it:
- Validate query is non-empty string
- Validate exactly one operation
- Execute against Linear API using configured auth
- Return structured result (success=true/false, data, errors)

### 3. Add Git/GitHub Setup to Hooks

The `after_create` hook should:
```bash
git clone --depth 1 <repo-url> .
git config user.email "hermes@abuusama.dev"
git config user.name "Hermes Agent"
gh auth login --with-token <<< "$GITHUB_TOKEN"
```

### 4. Update Prompt Template

The WORKFLOW.md prompt must instruct the agent on:
- Creating integration branches named `symphony/<issue-identifier>`
- Making commits with conventional format
- Creating PRs with proper descriptions
- Updating Linear states via `linear_graphql`
- Running validation before marking complete

### 5. Test Full Lifecycle

Create a real Capxul issue (or use existing CAP-32):
1. Issue in "Todo" state
2. Orchestrator picks it up
3. Agent moves it to "In Progress"
4. Agent creates branch, implements, commits
5. Agent creates PR, attaches to issue
6. Agent moves issue to "Human Review"
7. Human reviews PR
8. Human merges PR
9. Linear integration auto-moves issue to "Done"
10. Orchestrator sees terminal state, cleans workspace

## Acceptance Criteria

- [ ] Kimi bridge advertises `linear_graphql` tool
- [ ] Agent can successfully query Linear via tool
- [ ] Agent can create git branches in workspace
- [ ] Agent can commit and push changes
- [ ] Agent can create GitHub PRs
- [ ] Agent can update Linear issue states
- [ ] Full lifecycle test with real issue passes
- [ ] Orchestrator correctly cleans workspace when issue reaches terminal state

## Files to Modify

1. `~/symphony-ts/WORKFLOW.md` — update for Capxul project
2. `~/symphony-ts/src/agent/bridge.ts` — add `linear_graphql` tool advertisement
3. `~/symphony-ts/src/agent/tools/linear_graphql.ts` — implement tool handler
4. `~/symphony-ts/src/hooks.ts` — add git/gh setup helpers
5. `~/symphony-ts/src/prompt_builder.ts` — ensure `{{workflow.tools}}` includes tool list

## Definition of Done

A Capxul issue can be created in Linear, picked up by the orchestrator, fully implemented by the Kimi agent (branch → code → PR → Linear updates), reviewed by a human, merged, and the orchestrator will cleanly terminate and remove the workspace when Linear shows the issue as Done.
