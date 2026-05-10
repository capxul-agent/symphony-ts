// Run orchestrator for real - let it process CAP-34
import { Orchestrator, makeConfig } from "./dist/orchestrator.js";
import dotenv from "dotenv";

dotenv.config();

console.log("🎼 Starting Symphony Orchestrator...\n");
console.log("Project:", process.env.LINEAR_PROJECT_SLUG);

const config = makeConfig();
const orchestrator = new Orchestrator(config, "./WORKFLOW.md");

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...");
  await orchestrator.stop();
  process.exit(0);
});

await orchestrator.start();

// Keep running until manually stopped
console.log("\n✅ Orchestrator running. Press Ctrl+C to stop.");
console.log("Dashboard: http://localhost:8793");

// Keep alive
setInterval(() => {}, 1000);
