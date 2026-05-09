import { Effect } from "effect";
import { makeConfig } from "./src/domain.js";
import { WorkspaceManager } from "./src/workspace.js";

async function main() {
  const config = makeConfig();
  const manager = new WorkspaceManager(config.workspaceRoot);
  
  const workspace = manager.ensureWorkspace("CAP-32");
  const result = await Effect.runPromise(workspace);
  console.log("[test] Workspace path:", result);
  console.log("[test] Absolute path:", require("path").resolve(result));
}

main().catch(console.error);
