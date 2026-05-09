import { spawn } from "child_process";
import { mkdirSync, existsSync, readFileSync } from "fs";

const workspace = "/home/abuusama/symphony-ts/workspaces/CAP-32";
if (!existsSync(workspace)) {
  mkdirSync(workspace, { recursive: true });
}

const [cmd, ...args] = "python3 /opt/symphony/kimi_cli_bridge.py".split(" ");
const proc = spawn(cmd, args, {
  cwd: workspace,
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const pending = new Map<number, { resolve: (m: any) => void; reject: (e: Error) => void }>();
let requestId = 0;

proc.stdout?.on("data", (data: Buffer) => {
  const text = data.toString();
  buffer += text;
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
    } catch {
      // non-json
    }
  }
});

proc.stderr?.on("data", (data: Buffer) => {
  console.error("[stderr]", data.toString().trim());
});

function send(method: string, params?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const msg = { jsonrpc: "2.0", id, method, params };
    pending.set(id, { resolve, reject });
    proc.stdin?.write(JSON.stringify(msg) + "\n");
    console.log("[sent]", method, id);
  });
}

async function run() {
  await new Promise(r => setTimeout(r, 500));
  
  // 1. Initialize
  const init = await send("initialize", { capabilities: {} });
  console.log("[✓] initialize", init.result?.serverInfo?.name);
  
  // 2. Thread start
  const thread = await send("thread/start", { approvalPolicy: "auto", sandbox: "none", cwd: workspace });
  const threadId = thread.result?.thread?.id;
  console.log("[✓] thread/start", threadId);
  
  // 3. Turn start - the actual work
  const turn = await send("turn/start", {
    threadId,
    input: [{ type: "text", text: "Create a file called hello.txt with the content 'Hello from Symphony TypeScript!'" }],
    cwd: workspace,
    title: "CAP-32: Symphony smoke test"
  });
  console.log("[✓] turn/start", turn.result?.turn?.id);
  
  // Wait for Kimi to finish
  await new Promise(r => setTimeout(r, 60000));
  
  // 4. Verify file was created
  const filePath = `${workspace}/hello.txt`;
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, "utf-8");
    console.log("[✓] File created:", content);
  } else {
    console.log("[✗] File not created");
  }
  
  proc.kill();
}

run().catch(console.error);
