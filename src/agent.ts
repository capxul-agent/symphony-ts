import { Effect } from "effect";
import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, existsSync } from "fs";
import type { JsonRpcMessage, AgentEvent, AppConfig } from "./domain.js";

export class AgentError {
  readonly _tag = "AgentError";
  constructor(readonly message: string) {}
}

export class AgentRunner {
  private processes = new Map<string, ChildProcess>();
  private tools: Array<{ name: string; description: string; inputSchema: unknown }> = [];

  constructor(private config: AppConfig) {}

  setTools(tools: Array<{ name: string; description: string; inputSchema: unknown }>): void {
    this.tools = tools;
  }

  kill(issueId: string): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      const proc = this.processes.get(issueId);
      if (proc) {
        proc.kill("SIGTERM");
        this.processes.delete(issueId);
      }
    });
  }

  run(workspace: string, prompt: string, issue: { identifier: string; title: string; id: string }): Effect.Effect<AgentEvent[], AgentError> {
    return Effect.promise(async () => {
      // Ensure workspace exists
      if (!existsSync(workspace)) {
        mkdirSync(workspace, { recursive: true });
      }

      const [cmd, ...args] = this.config.codexCommand.split(" ");
      const proc = spawn(cmd, args, {
        cwd: workspace,
        env: { ...process.env, SYMPHONY_TOOLS: JSON.stringify(this.tools) },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.processes.set(issue.id, proc);

      let buffer = "";
      const pending = new Map<number | string, { resolve: (m: JsonRpcMessage) => void; reject: (e: Error) => void }>();
      let requestId = 0;

      proc.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as JsonRpcMessage;
            if ("id" in msg && pending.has(msg.id)) {
              const handler = pending.get(msg.id)!;
              pending.delete(msg.id);
              handler.resolve(msg);
            }
          } catch {
            // Ignore non-JSON lines
          }
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        console.error("[agent stderr]", data.toString());
      });

      function send(method: string, params?: Record<string, unknown>): Promise<JsonRpcMessage> {
        return new Promise((resolve, reject) => {
          const id = ++requestId;
          const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
          pending.set(id, { resolve, reject });
          proc.stdin?.write(JSON.stringify(message) + "\n");
        });
      }

      try {
        await new Promise(r => setTimeout(r, 500));

        // Initialize
        const init = await send("initialize", {
          capabilities: { experimentalApi: true },
          clientInfo: { name: "symphony-ts", version: "1.0.0" },
        });
        
        // Start thread
        const threadResp = await send("thread/start", {
          approvalPolicy: "auto",
          sandbox: "none",
          cwd: workspace,
        });
        const threadId = ((threadResp as any).result as any)?.thread?.id;
        if (!threadId) {
          throw new Error("No thread ID returned");
        }

        // Start turn
        const turnResp = await send("turn/start", {
          threadId,
          input: [{ type: "text", text: prompt }],
          cwd: workspace,
          title: `${issue.identifier}: ${issue.title}`,
        });
        const turnId = ((turnResp as any).result as any)?.turn?.id;

        // Wait for Kimi to finish processing
        await new Promise(r => setTimeout(r, 60000));

        const events: AgentEvent[] = [{
          event: "session_completed",
          timestamp: new Date().toISOString(),
          sessionId: `${threadId}-${turnId || "unknown"}`,
          payload: null,
        }];

        return events;
      } finally {
        proc.stdin?.end();
        proc.kill();
        this.processes.delete(issue.id);
      }
    }).pipe(
      Effect.catchAll((e) => Effect.fail(new AgentError(`Agent run failed: ${e}`)))
    );
  }
}
