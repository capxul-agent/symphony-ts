import { Effect } from "effect";
import { makeConfig } from "./src/domain.js";
import { Orchestrator } from "./src/orchestrator.js";

async function main() {
  const config = makeConfig();
  console.log("[test] Config:", {
    project: config.linearProjectSlug,
    workspaceRoot: config.workspaceRoot,
    codexCommand: config.codexCommand,
  });

  const orchestrator = new Orchestrator(config, "./WORKFLOW.md");
  
  console.log("[test] Starting orchestrator...");
  const program = orchestrator.start();
  
  Effect.runFork(program);
  
  // Let it run for 2 minutes
  await new Promise(r => setTimeout(r, 120000));
  
  console.log("[test] Stopping...");
  Effect.runFork(orchestrator.stop());
  
  const state = await Effect.runPromise(orchestrator.getState());
  console.log("[test] Final state:", Array.from(state.entries()));
  
  process.exit(0);
}

main().catch(console.error);
