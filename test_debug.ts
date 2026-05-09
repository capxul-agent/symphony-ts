import { Effect } from "effect";
import { AgentRunner } from "./src/agent.js";
import { makeConfig } from "./src/domain.js";

async function main() {
  const config = makeConfig();
  const runner = new AgentRunner(config);
  
  const workspace = "/home/abuusama/symphony-ts/workspaces/CAP-32";
  const prompt = `Create a file called hello.txt with the content "Hello from Symphony TypeScript!"`;
  const issue = { identifier: "CAP-32", title: "Symphony smoke test" };
  
  console.log("[test] Running agent...");
  const program = runner.run(workspace, prompt, issue);
  
  const events = await Effect.runPromise(program);
  console.log("[test] Events:", events);
  
  // Check file
  const fs = await import("fs");
  const files = fs.readdirSync(workspace);
  console.log("[test] Files in workspace:", files);
}

main().catch(console.error);
