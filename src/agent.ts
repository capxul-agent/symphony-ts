import { Effect } from "effect";
import { spawn } from "child_process";
import { mkdirSync, existsSync } from "fs";
import type { JsonRpcMessage, AgentEvent, AppConfig } from "./domain.js";

export class AgentError {
  readonly _tag = "AgentError";
  constructor(readonly message: string) {}
}

export class AgentRunner {
  constructor(private config: AppConfig) {}

  run(workspace: string, prompt: string, issue: { identifier: string; title: string }): Effect.Effect<AgentEvent[], AgentError> {
    return Effect.promise(async () => {
      // Ensure workspace exists
      if (!existsSync(workspace)) {
        mkdirSync(workspace, { recursive: true });
      }

      const [cmd, ...args] = this.config.codexCommand.split(" ");
      const proc = spawn(cmd, args, {
        cwd: workspace,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

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
        const threadId = (threadResp.result as any)?.thread?.id;
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
        const turnId = (turnResp.result as any)?.turn?.id;

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
      }
    }).pipe(
      Effect.catchAll((e) => Effect.fail(new AgentError(`Agent run failed: ${e}`)))
    );
  }
}
