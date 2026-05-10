// Full E2E test using the orchestrator module directly
import { Orchestrator, makeConfig } from "./dist/orchestrator.js";
import { setTimeout } from "timers/promises";
import fs from "fs";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

console.log("🎼 Starting full E2E test...\n");
console.log("LINEAR_PROJECT_SLUG:", process.env.LINEAR_PROJECT_SLUG);

// 1. Create orchestrator
const config = makeConfig();
const orchestrator = new Orchestrator(config, "./WORKFLOW.md");

console.log("1. Starting orchestrator...");
await orchestrator.start();

// 2. Wait for orchestrator to poll and dispatch
console.log("2. Waiting 60s for orchestrator to poll Linear and dispatch agent...");
await setTimeout(60000);

// 3. Check state
const state = orchestrator.getState();
console.log("\n3. Orchestrator state:");
for (const [id, worker] of state) {
  console.log(`   ${id}: ${worker.status} (session: ${worker.sessionId || 'none'})`);
}

// 4. Check dashboard API
console.log("\n4. Checking dashboard API...");
try {
  const res = await fetch("http://localhost:8793/api/v1/state");
  const snapshot = await res.json();
  console.log("   Running:", snapshot.running.length);
  console.log("   Retrying:", snapshot.retrying.length);
  
  const cap34 = snapshot.running.find(r => r.identifier === "CAP-34");
  if (cap34) {
    console.log("   ✅ CAP-34 is running!");
  } else {
    const retrying = snapshot.retrying.find(r => r.issueId === "3814bcb5-98d7-4c97-9d9e-bf23936141b8");
    if (retrying) {
      console.log("   ⏳ CAP-34 is retrying:", retrying);
    } else {
      console.log("   ⚠️ CAP-34 not found in running or retrying");
    }
  }
} catch (e) {
  console.error("   Dashboard error:", e.message);
}

// 5. Check workspace
console.log("\n5. Checking workspace...");
const workspacePath = "./workspaces/CAP-34";
if (fs.existsSync(workspacePath)) {
  console.log("   ✅ Workspace exists:", workspacePath);
  const files = fs.readdirSync(workspacePath);
  console.log("   Files:", files);
  
  if (fs.existsSync(workspacePath + "/.git")) {
    console.log("   ✅ Git repo cloned");
  }
  
  // Check for agent output
  if (fs.existsSync(workspacePath + "/.symphony")) {
    const logs = fs.readdirSync(workspacePath + "/.symphony");
    console.log("   Symphony logs:", logs);
  }
} else {
  console.log("   ❌ Workspace not created yet");
}

// 6. Wait a bit more for agent to work
console.log("\n6. Waiting another 60s for agent to process...");
await setTimeout(60000);

// 7. Check workspace again
console.log("\n7. Checking workspace after agent run...");
if (fs.existsSync(workspacePath)) {
  const files = fs.readdirSync(workspacePath);
  console.log("   Files:", files);
  
  // Check git status
  if (fs.existsSync(workspacePath + "/.git")) {
    console.log("   ✅ Git repo exists");
  }
}

// 8. Stop orchestrator
console.log("\n8. Stopping orchestrator...");
await orchestrator.stop();

console.log("\n✅ E2E test complete!");
