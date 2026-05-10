// Verify Kimi bridge works end-to-end
import { spawn } from "child_process";

const bridge = spawn("python3", ["/opt/symphony/kimi_cli_bridge.py"], {
  stdio: ["pipe", "pipe", "pipe"]
});

let buffer = "";
bridge.stdout.on("data", (data) => {
  buffer += data.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      console.log("⬅️  Received:", msg.method || msg.id, msg.result ? "✅" : "");
      if (msg.result) {
        console.log("   Result keys:", Object.keys(msg.result));
      }
    } catch {
      // Ignore non-JSON
    }
  }
});

bridge.stderr.on("data", (data) => {
  console.error("stderr:", data.toString().trim());
});

function send(method, params = {}) {
  const msg = { jsonrpc: "2.0", id: Date.now(), method, params };
  bridge.stdin.write(JSON.stringify(msg) + "\n");
  console.log("➡️  Sent:", method);
}

// Initialize
send("initialize", {
  capabilities: { experimentalApi: true },
  clientInfo: { name: "test", version: "1.0.0" }
});

setTimeout(() => {
  send("thread/start", {
    approvalPolicy: "auto",
    sandbox: "none",
    cwd: "/tmp"
  });
}, 1000);

setTimeout(() => {
  send("turn/start", {
    threadId: "test-thread",
    input: [{ type: "text", text: "Write a simple hello world Python script" }],
    cwd: "/tmp",
    title: "Test"
  });
}, 2000);

setTimeout(() => {
  bridge.kill();
  console.log("\n✅ Bridge test complete");
}, 30000);
