import { Effect } from "effect";
import { makeConfig } from "./src/domain.js";
import { Orchestrator } from "./src/orchestrator.js";
import { existsSync, readdirSync } from "fs";

async function main() {
  const config = makeConfig();
  const orchestrator = new Orchestrator(config, "./WORKFLOW.md");
  
  console.log("[debug] Workspace root from config:", config.workspaceRoot);
  
  const program = orchestrator.start();
  await Effect.runPromise(program);
  
  const state = await Effect.runPromise(orchestrator.getState());
  console.log("[debug] State:", Array.from(state.entries()));
  
  // Check both possible paths
  const relPath = `${config.workspaceRoot}/CAP-32`;
  const absPath = `/home/abuusama/symphony-ts/workspaces/CAP-32`;
  
  console.log("[debug] Relative path exists:", existsSync(relPath));
  console.log("[debug] Absolute path exists:", existsSync(absPath));
  
  if (existsSync(relPath)) {
    console.log("[debug] Files in relative path:", readdirSync(relPath));
  }
  if (existsSync(absPath)) {
    console.log("[debug] Files in absolute path:", readdirSync(absPath));
  }
  
  await Effect.runPromise(orchestrator.stop());
}

main().catch(console.error);
