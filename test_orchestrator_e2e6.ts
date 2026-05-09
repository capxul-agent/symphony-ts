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
  
  // Run synchronously - this will block until agent completes
  await Effect.runPromise(program);
  
  console.log("[test] Orchestrator start completed!");
  
  const state = await Effect.runPromise(orchestrator.getState());
  console.log("[test] Final state:", Array.from(state.entries()));
  
  // Check if file was created
  const fs = await import("fs");
  const filePath = `${config.workspaceRoot}/CAP-32/hello.txt`;
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    console.log("[test] ✓ File created:", content);
  } else {
    console.log("[test] ✗ File not created at", filePath);
  }
  
  process.exit(0);
}

main().catch(console.error);
