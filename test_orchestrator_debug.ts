import { Effect } from "effect";
import { makeConfig } from "./src/domain.js";
import { Orchestrator } from "./src/orchestrator.js";
import { existsSync, readdirSync } from "fs";

async function main() {
  const config = makeConfig();
  const orchestrator = new Orchestrator(config, "./WORKFLOW.md");
  
  console.log("[debug] Starting orchestrator...");
  const program = orchestrator.start();
  await Effect.runPromise(program);
  
  console.log("[debug] Orchestrator start completed");
  
  const state = await Effect.runPromise(orchestrator.getState());
  console.log("[debug] State:", Array.from(state.entries()));
  
  const workspacePath = `${config.workspaceRoot}/CAP-32`;
  console.log("[debug] Workspace exists:", existsSync(workspacePath));
  
  if (existsSync(workspacePath)) {
    const files = readdirSync(workspacePath);
    console.log("[debug] Files:", files);
  }
  
  await Effect.runPromise(orchestrator.stop());
}

main().catch(console.error);
