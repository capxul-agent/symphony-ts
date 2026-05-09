# Symphony TypeScript/Bun Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a clean, from-scratch Symphony orchestrator in TypeScript/Bun that polls Linear, manages per-issue workspaces, and orchestrates coding agents via JSON-RPC over stdio — with a terminal TUI for login and monitoring.

**Architecture:** Single-process Bun service with modular subsystems: Config/Workflow loader, Linear GraphQL client, Workspace manager, Orchestrator engine, JSON-RPC agent bridge, and an optional Ink-based terminal dashboard. All state is file-system-backed; no database required per SPEC.

**Tech Stack:** Bun runtime, TypeScript, Zod (validation), Ink (React TUI), Commander (CLI), GraphQL-request (Linear API), node-pty (agent stdio), Winston (structured logging).

---

## Phase 1: Foundation & CLI

### Task 1: Initialize Bun project with TypeScript

**Objective:** Create project skeleton with Bun, TypeScript, and core dependencies.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: Initialize project**

```bash
mkdir -p /opt/symphony-ts && cd /opt/symphony-ts
bun init -y
```

**Step 2: Install dependencies**

```bash
bun add zod ink commander graphql-request winston node-pty dotenv
bun add -d @types/node @types/bun typescript
```

**Step 3: Configure TypeScript**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Step 4: Commit**

```bash
git add .
git commit -m "chore: init bun project with typescript"
```

---

### Task 2: CLI Entry Point & Environment Loading

**Objective:** Create the main CLI with environment variable loading and basic command structure.

**Files:**
- Create: `src/index.ts`
- Create: `src/config/env.ts`
- Create: `src/types/index.ts`

**Step 1: Write env config loader**

`src/config/env.ts`:
```typescript
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  LINEAR_API_KEY: z.string().min(1),
  LINEAR_PROJECT_SLUG: z.string().min(1),
  WORKSPACE_ROOT: z.string().default('/opt/symphony-ts/workspaces'),
  CODEX_COMMAND: z.string().default('codex app-server'),
  POLL_INTERVAL_MS: z.coerce.number().default(60000),
  MAX_CONCURRENT_WORKERS: z.coerce.number().default(3),
  TURN_TIMEOUT_MS: z.coerce.number().default(300000),
  DASHBOARD_PORT: z.coerce.number().default(8793),
});

export const env = envSchema.parse(process.env);
```

**Step 2: Write main CLI**

`src/index.ts`:
```typescript
#!/usr/bin/env bun
import { Command } from 'commander';
import { env } from './config/env.js';

const program = new Command();

program
  .name('symphony')
  .description('Symphony orchestrator for Linear-integrated agent workflows')
  .version('1.0.0');

program
  .command('start')
  .description('Start the orchestrator daemon')
  .action(async () => {
    console.log('Starting Symphony orchestrator...');
    console.log('Project:', env.LINEAR_PROJECT_SLUG);
    // TODO: Start orchestrator
  });

program
  .command('dashboard')
  .description('Start the terminal dashboard')
  .action(async () => {
    console.log('Starting dashboard...');
    // TODO: Start Ink TUI
  });

program.parse();
```

**Step 3: Verify build**

```bash
bun run src/index.ts --help
```

**Step 4: Commit**

```bash
git add src/ && git commit -m "feat: cli entry point and env loading"
```

---

## Phase 2: Core Subsystems

### Task 3: Workflow Loader & Config Layer

**Objective:** Parse WORKFLOW.md YAML front matter and prompt template per SPEC Section 3.1.

**Files:**
- Create: `src/workflow/loader.ts`
- Create: `src/workflow/types.ts`
- Create: `src/config/settings.ts`

**Step 1: Write workflow types**

`src/workflow/types.ts`:
```typescript
export interface WorkflowConfig {
  tracker: {
    kind: 'linear';
    project_slug: string;
  };
  states: {
    active: string[];
    terminal: string[];
  };
  codex: {
    command: string;
    read_timeout_ms: number;
    turn_timeout_ms: number;
    stall_timeout_ms: number;
  };
  workspace: {
    root: string;
  };
}

export interface Workflow {
  config: WorkflowConfig;
  prompt_template: string;
}
```

**Step 2: Write YAML front matter parser**

`src/workflow/loader.ts`:
```typescript
import { readFileSync } from 'fs';
import { Workflow, WorkflowConfig } from './types.js';

export function loadWorkflow(path: string): Workflow {
  const content = readFileSync(path, 'utf-8');
  
  // Parse YAML front matter between --- delimiters
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid WORKFLOW.md: missing YAML front matter');
  }
  
  // TODO: Use yaml library to parse front matter
  const config = parseYamlFrontMatter(match[1]) as WorkflowConfig;
  const prompt_template = match[2].trim();
  
  return { config, prompt_template };
}

function parseYamlFrontMatter(yaml: string): unknown {
  // TODO: Implement or use yaml library
  return {};
}
```

**Step 3: Commit**

```bash
git add src/workflow/ && git commit -m "feat: workflow loader and config types"
```

---

### Task 4: Linear GraphQL Client

**Objective:** Implement Linear tracker client per SPEC Section 11.

**Files:**
- Create: `src/tracker/linear.ts`
- Create: `src/tracker/types.ts`

**Step 1: Write tracker types**

`src/tracker/types.ts`:
```typescript
export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: string;
  priority?: number;
  labels: string[];
  created_at: string;
  updated_at: string;
  url: string;
}

export interface TrackerClient {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(states: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(ids: string[]): Promise<Map<string, string>>;
}
```

**Step 2: Write Linear GraphQL client**

`src/tracker/linear.ts`:
```typescript
import { GraphQLClient, gql } from 'graphql-request';
import { TrackerClient, Issue } from './types.js';
import { env } from '../config/env.js';

const ENDPOINT = 'https://api.linear.app/graphql';

export class LinearClient implements TrackerClient {
  private client: GraphQLClient;

  constructor() {
    this.client = new GraphQLClient(ENDPOINT, {
      headers: { Authorization: env.LINEAR_API_KEY },
    });
  }

  async fetchCandidateIssues(): Promise<Issue[]> {
    const query = gql`
      query($projectSlug: String!) {
        issues(
          filter: {
            project: { slugId: { eq: $projectSlug } }
            state: { name: { in: ["Todo", "In Progress"] } }
          }
        ) {
          nodes {
            id
            identifier
            title
            description
            state { name }
            priority
            labels { nodes { name } }
            createdAt
            updatedAt
            url
          }
        }
      }
    `;
    
    const data = await this.client.request(query, { projectSlug: env.LINEAR_PROJECT_SLUG });
    return (data as any).issues.nodes.map(normalizeIssue);
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    // TODO: Implement
    return [];
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Map<string, string>> {
    // TODO: Implement
    return new Map();
  }
}

function normalizeIssue(node: any): Issue {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description,
    state: node.state.name,
    priority: node.priority,
    labels: node.labels?.nodes.map((l: any) => l.name.toLowerCase()) || [],
    created_at: node.createdAt,
    updated_at: node.updatedAt,
    url: node.url,
  };
}
```

**Step 3: Commit**

```bash
git add src/tracker/ && git commit -m "feat: linear graphql client"
```

---

### Task 5: Workspace Manager

**Objective:** Implement per-issue workspace creation and isolation per SPEC Section 3.1.

**Files:**
- Create: `src/workspace/manager.ts`

**Step 1: Write workspace manager**

`src/workspace/manager.ts`:
```typescript
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { env } from '../config/env.js';

export class WorkspaceManager {
  private root: string;

  constructor() {
    this.root = env.WORKSPACE_ROOT;
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
  }

  getWorkspacePath(issueIdentifier: string): string {
    // Sanitize: only [A-Za-z0-9._-], replace others with _
    const sanitized = issueIdentifier.replace(/[^A-Za-z0-9._-]/g, '_');
    return join(this.root, sanitized);
  }

  ensureWorkspace(issueIdentifier: string): string {
    const path = this.getWorkspacePath(issueIdentifier);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
    return path;
  }

  cleanupWorkspace(issueIdentifier: string): void {
    const path = this.getWorkspacePath(issueIdentifier);
    // TODO: Implement cleanup with rimraf
  }
}
```

**Step 2: Commit**

```bash
git add src/workspace/ && git commit -m "feat: workspace manager"
```

---

## Phase 3: Agent Runner & JSON-RPC Protocol

### Task 6: JSON-RPC App-Server Client

**Objective:** Implement the Codex-compatible JSON-RPC 2.0 client over stdio per SPEC Section 10.

**Files:**
- Create: `src/agent/jsonrpc.ts`
- Create: `src/agent/types.ts`
- Create: `src/agent/bridge.ts`

**Step 1: Write JSON-RPC types**

`src/agent/types.ts`:
```typescript
export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface Session {
  threadId: string;
  turnId?: string;
  workspace: string;
}
```

**Step 2: Write JSON-RPC stdio client**

`src/agent/jsonrpc.ts`:
```typescript
import { spawn } from 'node-pty';
import { JsonRpcMessage } from './types.js';
import EventEmitter from 'events';

export class JsonRpcClient extends EventEmitter {
  private pty: any;
  private pendingRequests: Map<number | string, { resolve: Function; reject: Function }> = new Map();
  private requestId = 0;

  constructor(command: string, cwd: string) {
    super();
    this.pty = spawn('bash', ['-lc', command], {
      cwd,
      env: process.env as { [key: string]: string },
    });

    this.pty.onData((data: string) => this.handleData(data));
    this.pty.onExit(({ exitCode }: { exitCode: number }) => {
      this.emit('exit', exitCode);
    });
  }

  send(method: string, params?: Record<string, unknown>): Promise<JsonRpcMessage> {
    const id = ++this.requestId;
    const message: JsonRpcMessage = { jsonrpc: '2.0', id, method, params };
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.pty.write(JSON.stringify(message) + '\n');
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    const message: JsonRpcMessage = { jsonrpc: '2.0', method, params };
    this.pty.write(JSON.stringify(message) + '\n');
  }

  private handleData(data: string): void {
    // TODO: Buffer and parse newline-delimited JSON
    // TODO: Match responses to pending requests
    // TODO: Emit events for streaming updates
  }

  close(): void {
    this.pty.kill();
  }
}
```

**Step 3: Commit**

```bash
git add src/agent/ && git commit -m "feat: json-rpc stdio client skeleton"
```

---

### Task 7: Agent Runner with Kimi Bridge

**Objective:** Implement the agent runner that initializes sessions and processes turns.

**Files:**
- Create: `src/agent/runner.ts`
- Modify: `src/agent/bridge.ts` (complete implementation)

**Step 1: Write agent runner**

`src/agent/runner.ts`:
```typescript
import { JsonRpcClient } from './jsonrpc.js';
import { Session } from './types.js';
import { env } from '../config/env.js';

export interface AgentEvent {
  event: string;
  timestamp: string;
  session_id?: string;
  payload?: unknown;
}

export class AgentRunner {
  async run(workspace: string, prompt: string, issue: any): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    const client = new JsonRpcClient(env.CODEX_COMMAND, workspace);

    try {
      // Initialize
      await client.send('initialize', {
        capabilities: { experimentalApi: true },
        clientInfo: { name: 'symphony-ts', version: '1.0.0' },
      });
      client.notify('initialized', {});

      // Start thread
      const threadResp = await client.send('thread/start', {
        approvalPolicy: 'auto',
        sandbox: 'none',
        cwd: workspace,
      });
      const threadId = (threadResp.result as any).thread.id;

      // Start turn
      const turnResp = await client.send('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
        cwd: workspace,
        title: `${issue.identifier}: ${issue.title}`,
      });
      const turnId = (turnResp.result as any).turn.id;

      // TODO: Stream and process turn completion
      
      events.push({
        event: 'session_completed',
        timestamp: new Date().toISOString(),
        session_id: `${threadId}-${turnId}`,
      });

    } finally {
      client.close();
    }

    return events;
  }
}
```

**Step 2: Commit**

```bash
git add src/agent/ && git commit -m "feat: agent runner skeleton"
```

---

## Phase 4: Orchestrator Engine

### Task 8: Orchestrator with Polling & Concurrency

**Objective:** Implement the main orchestrator that polls Linear and dispatches workers per SPEC Section 3.1.

**Files:**
- Create: `src/orchestrator/engine.ts`
- Create: `src/orchestrator/types.ts`
- Create: `src/orchestrator/worker.ts`

**Step 1: Write orchestrator types**

`src/orchestrator/types.ts`:
```typescript
export interface WorkerState {
  issueId: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  sessionId?: string;
  startedAt: string;
  lastHeartbeat?: string;
}

export interface OrchestratorState {
  workers: Map<string, WorkerState>;
  lastPollTime?: string;
}
```

**Step 2: Write worker**

`src/orchestrator/worker.ts`:
```typescript
import { Issue } from '../tracker/types.js';
import { AgentRunner, AgentEvent } from '../agent/runner.js';
import { WorkspaceManager } from '../workspace/manager.js';

export class Worker {
  constructor(
    private issue: Issue,
    private workspaceManager: WorkspaceManager,
    private agentRunner: AgentRunner,
  ) {}

  async run(promptTemplate: string): Promise<AgentEvent[]> {
    const workspace = this.workspaceManager.ensureWorkspace(this.issue.identifier);
    const prompt = this.renderPrompt(promptTemplate);
    return this.agentRunner.run(workspace, prompt, this.issue);
  }

  private renderPrompt(template: string): string {
    // TODO: Implement template rendering with issue variables
    return template;
  }
}
```

**Step 3: Write orchestrator engine**

`src/orchestrator/engine.ts`:
```typescript
import { LinearClient } from '../tracker/linear.js';
import { WorkspaceManager } from '../workspace/manager.js';
import { AgentRunner } from '../agent/runner.js';
import { Worker } from './worker.js';
import { OrchestratorState, WorkerState } from './types.js';
import { env } from '../config/env.js';

export class Orchestrator {
  private state: OrchestratorState = { workers: new Map() };
  private tracker = new LinearClient();
  private workspaces = new WorkspaceManager();
  private agent = new AgentRunner();
  private timer?: ReturnType<typeof setInterval>;

  start(): void {
    console.log('Orchestrator starting...');
    this.tick();
    this.timer = setInterval(() => this.tick(), env.POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    console.log('Orchestrator stopped');
  }

  private async tick(): Promise<void> {
    try {
      const issues = await this.tracker.fetchCandidateIssues();
      
      for (const issue of issues) {
        if (this.state.workers.has(issue.id)) continue;
        if (this.state.workers.size >= env.MAX_CONCURRENT_WORKERS) break;

        const worker = new Worker(issue, this.workspaces, this.agent);
        this.state.workers.set(issue.id, {
          issueId: issue.id,
          status: 'running',
          startedAt: new Date().toISOString(),
        });

        // Run worker asynchronously
        worker.run('').then((events) => {
          console.log(`Worker completed for ${issue.identifier}:`, events);
          const w = this.state.workers.get(issue.id);
          if (w) w.status = 'completed';
        }).catch((err) => {
          console.error(`Worker failed for ${issue.identifier}:`, err);
          const w = this.state.workers.get(issue.id);
          if (w) w.status = 'failed';
        });
      }
    } catch (err) {
      console.error('Tick failed:', err);
    }
  }
}
```

**Step 4: Commit**

```bash
git add src/orchestrator/ && git commit -m "feat: orchestrator engine with polling"
```

---

## Phase 5: Terminal TUI Dashboard

### Task 9: Ink-based Terminal Dashboard

**Objective:** Create a terminal UI for monitoring the orchestrator using Ink (React for terminals).

**Files:**
- Create: `src/dashboard/app.tsx`
- Create: `src/dashboard/components/WorkerList.tsx`
- Create: `src/dashboard/components/StatusBar.tsx`

**Step 1: Write dashboard app**

`src/dashboard/app.tsx`:
```tsx
import React from 'react';
import { render, Text, Box } from 'ink';
import { WorkerList } from './components/WorkerList.js';
import { StatusBar } from './components/StatusBar.js';

interface DashboardProps {
  orchestratorState: any; // TODO: Type properly
}

function Dashboard({ orchestratorState }: DashboardProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">Symphony Orchestrator</Text>
      <StatusBar state={orchestratorState} />
      <WorkerList workers={orchestratorState?.workers || new Map()} />
    </Box>
  );
}

export function startDashboard(state: any) {
  render(<Dashboard orchestratorState={state} />);
}
```

**Step 2: Write worker list component**

`src/dashboard/components/WorkerList.tsx`:
```tsx
import React from 'react';
import { Text, Box } from 'ink';

interface WorkerListProps {
  workers: Map<string, any>;
}

export function WorkerList({ workers }: WorkerListProps) {
  if (workers.size === 0) {
    return <Text dimColor>No active workers</Text>;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Active Workers:</Text>
      {Array.from(workers.entries()).map(([id, worker]) => (
        <Box key={id} marginLeft={2}>
          <Text>
            {worker.issueId} — <Text color={getStatusColor(worker.status)}>{worker.status}</Text>
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'running': return 'yellow';
    case 'completed': return 'green';
    case 'failed': return 'red';
    default: return 'white';
  }
}
```

**Step 3: Commit**

```bash
git add src/dashboard/ && git commit -m "feat: ink terminal dashboard skeleton"
```

---

## Phase 6: Integration & Testing

### Task 10: Wire Everything Together

**Objective:** Connect all subsystems in the main entry point.

**Files:**
- Modify: `src/index.ts`

**Step 1: Update main entry point**

```typescript
#!/usr/bin/env bun
import { Command } from 'commander';
import { Orchestrator } from './orchestrator/engine.js';
import { startDashboard } from './dashboard/app.js';

const program = new Command();

program
  .name('symphony')
  .description('Symphony orchestrator for Linear-integrated agent workflows')
  .version('1.0.0');

program
  .command('start')
  .description('Start the orchestrator daemon')
  .option('-d, --dashboard', 'Start with terminal dashboard')
  .action(async (options) => {
    const orchestrator = new Orchestrator();
    
    if (options.dashboard) {
      startDashboard(orchestrator.getState());
    }
    
    orchestrator.start();
    
    process.on('SIGINT', () => {
      orchestrator.stop();
      process.exit(0);
    });
  });

program.parse();
```

**Step 2: Commit**

```bash
git add src/index.ts && git commit -m "feat: wire all subsystems together"
```

---

### Task 11: Add Structured Logging

**Objective:** Implement Winston-based structured logging per SPEC observability requirements.

**Files:**
- Create: `src/logging/logger.ts`

**Step 1: Write logger**

```typescript
import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  defaultMeta: { service: 'symphony' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'symphony.log' }),
  ],
});
```

**Step 2: Commit**

```bash
git add src/logging/ && git commit -m "feat: structured logging with winston"
```

---

## Phase 7: Kimi Integration

### Task 12: Kimi API Bridge

**Objective:** Create a Kimi-specific agent bridge that replaces Codex with Kimi's OpenAI-compatible API.

**Files:**
- Create: `src/agent/kimi-bridge.ts`

**Step 1: Write Kimi bridge**

```typescript
import { JsonRpcClient } from './jsonrpc.js';

export class KimiBridge extends JsonRpcClient {
  constructor(workspace: string) {
    // Instead of spawning codex, spawn our Python bridge or connect directly
    super('python3 /opt/symphony/kimi_bridge.py', workspace);
  }
}
```

**Step 2: Or implement direct Kimi API client**

Alternative: Skip JSON-RPC entirely and have the orchestrator call Kimi API directly, then implement tool execution in TypeScript.

**Step 3: Commit**

```bash
git add src/agent/kimi-bridge.ts && git commit -m "feat: kimi api bridge"
```

---

## Verification & Acceptance

### How to verify the implementation:

1. **Build check:** `bun run build` should succeed
2. **CLI check:** `bun run src/index.ts --help` should show commands
3. **Env check:** `bun run src/index.ts start` should load env vars
4. **Linear check:** Verify candidate issues are fetched
5. **Workspace check:** Verify directories are created per issue
6. **Agent check:** Verify JSON-RPC messages are exchanged
7. **Dashboard check:** `bun run src/index.ts start --dashboard` should show TUI

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1 | 1-2 | Project setup, CLI, env loading |
| 2 | 3-5 | Workflow loader, Linear client, workspaces |
| 3 | 6-7 | JSON-RPC protocol, agent runner |
| 4 | 8 | Orchestrator engine with polling |
| 5 | 9 | Terminal TUI dashboard |
| 6 | 10-11 | Integration, logging |
| 7 | 12 | Kimi API bridge |

**Total estimated time:** 4-6 hours of focused implementation.

**Next step:** Dispatch reviewer to validate this plan, then execute task-by-task.
