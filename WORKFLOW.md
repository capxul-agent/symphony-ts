---
tracker:
  kind: linear
  project_slug: symphony-0c79b11b75ea
states:
  active:
    - Todo
    - In Progress
  terminal:
    - Done
    - Cancelled
codex:
  command: python3 /opt/symphony/kimi_cli_bridge.py
  read_timeout_ms: 5000
  turn_timeout_ms: 300000
  stall_timeout_ms: 60000
workspace:
  root: /opt/symphony-ts/workspaces
hooks:
  pre_run: echo "Starting work on {{identifier}}"
  post_run: echo "Completed work on {{identifier}}"
---

# Workflow: {{identifier}}

You are an autonomous coding agent working on issue {{identifier}}: {{title}}.

## Context
- Issue: {{identifier}}
- Title: {{title}}
- Description: {{description}}
- Current State: {{state}}

## Instructions
1. Read the issue description carefully
2. Create or modify files as needed
3. Write tests if applicable
4. Update the issue status when done

## Workspace
All work should be done in the current directory.
