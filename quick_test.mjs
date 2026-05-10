// Quick test: Start orchestrator, let it run for 30s, check results
import { Orchestrator, makeConfig } from "./dist/orchestrator.js";
import dotenv from "dotenv";

dotenv.config();

console.log("🎼 Quick E2E test (30s)...\n");

const config = makeConfig();
const orchestrator = new Orchestrator(config, "./WORKFLOW.md");

await orchestrator.start();

// Wait 30s for agent to work
await new Promise(r => setTimeout(r, 30000));

// Check state
const state = orchestrator.getState();
console.log("\n📊 State after 30s:");
for (const [id, worker] of state) {
  console.log(`   ${id}: ${worker.status} (session: ${worker.sessionId || 'none'})`);
}

// Check workspace
import fs from "fs";
const wsPath = config.workspaceRoot + "/CAP-34";
console.log("\n📁 Workspace:", wsPath);
if (fs.existsSync(wsPath)) {
  const files = fs.readdirSync(wsPath);
  console.log("   Files:", files);
} else {
  console.log("   ❌ Not created");
}

await orchestrator.stop();
console.log("\n✅ Done!");
