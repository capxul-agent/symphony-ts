import { Effect, Fiber } from "effect";

async function main() {
  console.log("[test] Starting fiber test with actual agent...");
  
  const program = Effect.gen(function* () {
    const fiber = yield* Effect.fork(
      Effect.gen(function* () {
        console.log("[inner] Starting agent run...");
        
        const { spawn } = await import("child_process");
        const proc = spawn("python3", ["/opt/symphony/kimi_cli_bridge.py"], {
          cwd: "/home/abuusama/symphony-ts/workspaces/CAP-32",
        });
        
        let buffer = "";
        const pending = new Map<number, { resolve: (m: any) => void }>();
        let requestId = 0;
        
        proc.stdout?.on("data", (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const msg = JSON.parse(trimmed);
              if (msg.id && pending.has(msg.id)) {
                pending.get(msg.id)!.resolve(msg);
                pending.delete(msg.id);
              }
            } catch {}
          }
        });
        
        function send(method: string, params?: any): Promise<any> {
          return new Promise((resolve) => {
            const id = ++requestId;
            const msg = { jsonrpc: "2.0", id, method, params };
            pending.set(id, { resolve });
            proc.stdin?.write(JSON.stringify(msg) + "\n");
          });
        }
        
        await new Promise(r => setTimeout(r, 500));
        
        const init = await send("initialize", { capabilities: {} });
        console.log("[inner] init:", init.result?.serverInfo?.name);
        
        const thread = await send("thread/start", { approvalPolicy: "auto", sandbox: "none", cwd: "/home/abuusama/symphony-ts/workspaces/CAP-32" });
        const threadId = thread.result?.thread?.id;
        console.log("[inner] thread:", threadId);
        
        const turn = await send("turn/start", {
          threadId,
          input: [{ type: "text", text: "Create a file called hello3.txt with the content 'Hello from Fiber!'" }],
          cwd: "/home/abuusama/symphony-ts/workspaces/CAP-32",
          title: "CAP-32: Fiber test"
        });
        console.log("[inner] turn:", turn.result?.turn?.id);
        
        await new Promise(r => setTimeout(r, 60000));
        proc.kill();
        
        console.log("[inner] Agent run completed!");
        return "done";
      })
    );
    
    console.log("[outer] Fiber forked, waiting for join...");
    const result = yield* Fiber.join(fiber);
    console.log("[outer] Joined! Result:", result);
  });
  
  await Effect.runPromise(program);
  console.log("[test] Done");
}

main().catch(console.error);
