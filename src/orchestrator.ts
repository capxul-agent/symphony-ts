import { Effect, Ref } from "effect";
import type { AppConfig, Issue, WorkerState, AgentEvent } from "./domain.js";
import { LinearClient } from "./linear.js";
import { WorkspaceManager } from "./workspace.js";
import { AgentRunner } from "./agent.js";
import { loadWorkflow } from "./workflow.js";

export class OrchestratorError {
  readonly _tag = "OrchestratorError";
  constructor(readonly message: string) {}
}

export class Orchestrator {
  private state: Ref.Ref<Map<string, WorkerState>>;
  private tracker: LinearClient;
  private workspaces: WorkspaceManager;
  private agent: AgentRunner;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config: AppConfig,
    private workflowPath: string
  ) {
    this.tracker = new LinearClient(config.linearApiKey);
    this.workspaces = new WorkspaceManager(config.workspaceRoot);
    this.agent = new AgentRunner(config);
    this.state = Ref.unsafeMake(new Map());
  }

  start(): Effect.Effect<void, OrchestratorError, never> {
    return Effect.gen(this, function* () {
      console.log("[symphony] Starting orchestrator...");
      
      const workflow = yield* loadWorkflow(this.workflowPath).pipe(
        Effect.catchAll((e: unknown) => Effect.fail(new OrchestratorError(`Failed to load workflow: ${e}`)))
      );
      
      console.log(`[symphony] Loaded workflow for project: ${workflow.config.tracker.projectSlug}`);
      console.log(`[symphony] Active states: ${workflow.config.states.active.join(", ")}`);
      
      // Do initial tick
      yield* this.tick(workflow);
      
      // Schedule recurring ticks
      this.timer = setInterval(() => {
        Effect.runFork(this.tick(workflow));
      }, this.config.pollIntervalMs);
      
      console.log("[symphony] Polling started");
    });
  }

  stop(): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      console.log("[symphony] Orchestrator stopped");
    });
  }

  private tick(workflow: { config: { states: { active: string[] } }; promptTemplate: string }): Effect.Effect<void, never, never> {
    return Effect.gen(this, function* () {
      const issues = yield* this.tracker.fetchCandidateIssues(
        this.config.linearProjectSlug,
        workflow.config.states.active
      ).pipe(
        Effect.catchAll((e: unknown) => {
          console.error("[symphony] Failed to fetch issues:", e);
          return Effect.succeed([] as Issue[]);
        })
      );

      console.log(`[symphony] Found ${issues.length} candidate issues`);

      for (const issue of issues) {
        const currentWorkers = yield* Ref.get(this.state);
        if (currentWorkers.has(issue.id)) continue;
        if (currentWorkers.size >= this.config.maxConcurrentWorkers) break;

        console.log(`[symphony] Dispatching worker for ${issue.identifier}: ${issue.title}`);

        // Create workspace
        const workspace = yield* this.workspaces.ensureWorkspace(issue.identifier).pipe(
          Effect.catchAll((e: unknown) => {
            console.error(`[symphony] Workspace error for ${issue.identifier}:`, e);
            return Effect.succeed("");
          })
        );
        
        if (!workspace) continue;

        // Update state to running
        yield* Ref.update(this.state, (workers) => {
          const next = new Map(workers);
          next.set(issue.id, {
            issueId: issue.id,
            status: "running",
            sessionId: null,
            startedAt: new Date().toISOString(),
            lastHeartbeat: null,
          });
          return next;
        });

        // Build prompt
        const prompt = this.buildPrompt(issue, workflow);
        
        // Run agent
        const events = yield* this.agent.run(workspace, prompt, issue).pipe(
          Effect.timeout(this.config.turnTimeoutMs),
          Effect.catchAll((e: unknown) => {
            console.error(`[symphony] Agent failed for ${issue.identifier}:`, e);
            return Effect.succeed([] as AgentEvent[]);
          })
        );
        
        console.log(`[symphony] Worker completed for ${issue.identifier}:`, events.length, "events");
        
        // Update state to completed
        yield* Ref.update(this.state, (workers) => {
          const next = new Map(workers);
          const worker = next.get(issue.id);
          if (worker) {
            next.set(issue.id, { ...worker, status: "completed" });
          }
          return next;
        });
      }
    }).pipe(Effect.catchAll(() => Effect.void));
  }

  private buildPrompt(issue: Issue, workflow: { promptTemplate: string }): string {
    return workflow.promptTemplate
      .replace(/\{\{identifier\}\}/g, issue.identifier)
      .replace(/\{\{title\}\}/g, issue.title)
      .replace(/\{\{description\}\}/g, issue.description || "")
      .replace(/\{\{state\}\}/g, issue.state);
  }

  getState(): Effect.Effect<Map<string, WorkerState>, never, never> {
    return Ref.get(this.state);
  }
}
