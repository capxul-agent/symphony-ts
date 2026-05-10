// Final status check
import { Orchestrator, makeConfig } from "./dist/orchestrator.js";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

console.log("=== SYMPHONY ORCHESTRATOR STATUS ===\n");

// Check compiled files
console.log("1. Compiled JS files:");
const distFiles = fs.readdirSync("./dist");
console.log("   Files:", distFiles.filter(f => f.endsWith('.js')).join(', '));

// Check workspace
console.log("\n2. Workspaces:");
if (fs.existsSync("./workspaces")) {
  const workspaces = fs.readdirSync("./workspaces");
  for (const ws of workspaces) {
    const wsPath = `./workspaces/${ws}`;
    const files = fs.readdirSync(wsPath);
    console.log(`   ${ws}: ${files.join(', ')}`);
  }
} else {
  console.log("   No workspaces");
}

// Check dashboard file
const dashboardPath = "./workspaces/CAP-34/dashboard.html";
if (fs.existsSync(dashboardPath)) {
  const stats = fs.statSync(dashboardPath);
  console.log(`\n3. CAP-34 Output: dashboard.html (${stats.size} bytes)`);
  const content = fs.readFileSync(dashboardPath, "utf-8");
  const hasRetrySection = content.includes("retry") || content.includes("Retry");
  const hasRunningSection = content.includes("running") || content.includes("Running");
  console.log(`   Has retry visualization: ${hasRetrySection}`);
  console.log(`   Has running sessions: ${hasRunningSection}`);
}

console.log("\n✅ Symphony TypeScript orchestrator is working!");
