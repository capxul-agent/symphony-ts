import { Effect } from "effect";
import { AgentRunner } from "./src/agent.js";
import { makeConfig } from "./src/domain.js";

async function main() {
  const config = makeConfig();
  const runner = new AgentRunner(config);
  
  const workspace = "./workspaces/CAP-32";
  const prompt = `Create a file called hello.txt with the content "Hello from Symphony TypeScript!"`;
  const issue = { identifier: "CAP-32", title: "Symphony smoke test" };
  
  console.log("[test] Running agent...");
  const program = runner.run(workspace, prompt, issue);
  
  const events = await Effect.runPromise(program);
  console.log("[test] Events:", events);
}

main().catch(console.error);
