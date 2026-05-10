---
tracker:
  kind: linear
  project_slug: 8e254c24eebe
states:
  active:
    - Todo
    - In Progress
    - In Review
  terminal:
    - Done
    - Cancelled
    - Duplicate
codex:
  command: python3 /opt/symphony/kimi_cli_bridge.py
  read_timeout_ms: 5000
  turn_timeout_ms: 300000
  stall_timeout_ms: 60000
workspace:
  root: /opt/symphony-ts/workspaces
hooks:
  after_create: |
    # Clone Capxul repo and set up git
    git clone --depth 1 https://github.com/capxul/capxul.git .
    git config user.email "hermes@abuusama.dev"
    git config user.name "Hermes Agent"
    # Verify gh CLI is available
    if command -v gh >/dev/null 2>&1; then
      echo "GitHub CLI available"
    else
      echo "WARNING: gh CLI not available"
    fi
  before_run: |
    # Ensure we're in the repo directory
    if [ -d .git ]; then
      git fetch origin main
      echo "Ready to work on {{identifier}}"
    fi
  after_run: |
    # Push any pending changes
    if [ -d .git ]; then
      git push origin $(git branch --show-current) || true
    fi
    echo "Completed work on {{identifier}}"
  before_remove: |
    # Close any open PRs for this branch
    if command -v gh >/dev/null 2>&1; then
      BRANCH=$(git branch --show-current 2>/dev/null || echo "")
      if [ -n "$BRANCH" ]; then
        gh pr list --head "$BRANCH" --state open --json number | jq -r '.[].number' | while read PR; do
          gh pr close "$PR" --comment "Closing because issue entered terminal state"
        done
      fi
    fi
---

# Capxul Development Workflow

You are an autonomous coding agent working on Capxul issue {{issue.identifier}}: {{issue.title}}.

## Issue Context
- **Identifier**: {{issue.identifier}}
- **Title**: {{issue.title}}
- **Current State**: {{issue.state}}
{{#if issue.description}}
- **Description**: {{issue.description}}
{{/if}}

## Your Mission
Implement the issue end-to-end: create a branch, write code, add tests, create a PR, and update Linear.

## Workflow

### Step 1: Start Work (if state is "Todo")
1. Move issue to "In Progress" using `linear_graphql` tool
2. Create integration branch: `symphony/{{issue.identifier}}`
3. Check out the branch

### Step 2: Implementation
1. Read the issue description carefully
2. Explore the codebase to understand context
3. Implement the required changes
4. Add or update tests as needed
5. Run tests to verify

### Step 3: Commit and Push
1. Stage changes: `git add -A`
2. Commit with conventional format: `feat({{issue.identifier}}): <description>`
3. Push branch: `git push origin symphony/{{issue.identifier}}`

### Step 4: Create PR
1. Create PR with `gh pr create`
2. Title: `{{issue.identifier}}: {{issue.title}}`
3. Link PR to Linear issue in description
4. Add label `symphony`

### Step 5: Update Linear
1. Move issue to "In Review" using `linear_graphql`
2. Attach PR URL to issue
3. Add workpad comment with progress summary

### Step 6: Wait for Review
- Do NOT make changes while in "In Review"
- Poll for PR comments/reviews
- If changes requested, address them and update PR

### Step 7: Merge (when approved)
1. Ensure all checks pass
2. Merge PR: `gh pr merge --squash`
3. Move issue to "Done" using `linear_graphql`

## Available Tools
- `linear_graphql`: Execute GraphQL queries/mutations against Linear
  - Query issues, update states, add comments
  - Always use this for Linear interactions

## Branch Naming
- Always use: `symphony/{{issue.identifier}}`
- Example: `symphony/CAP-42`

## Commit Format
- `feat({{issue.identifier}}): description`
- `fix({{issue.identifier}}): description`
- `test({{issue.identifier}}): description`
- `docs({{issue.identifier}}): description`

## PR Requirements
- Link to Linear issue: `Closes {{issue.identifier}}`
- Include test plan
- Add `symphony` label

## Important Rules
- Work ONLY in the current workspace directory
- NEVER touch files outside the workspace
- ALWAYS run tests before creating PR
- ALWAYS update Linear state when transitioning phases
- If blocked, report blocker in workpad comment and move to "In Review"
