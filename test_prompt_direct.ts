import { Effect } from "effect";
import { AgentRunner } from "./src/agent.js";
import { makeConfig } from "./src/domain.js";
import { loadWorkflow } from "./src/workflow.js";

async function main() {
  const config = makeConfig();
  const workflow = await Effect.runPromise(loadWorkflow("./WORKFLOW.md"));
  
  const workspace = "/home/abuusama/symphony-ts/workspaces/CAP-32";
  const issue = {
    identifier: "CAP-32",
    title: "Symphony smoke test: write a hello file",
    description: "Create a hello.txt file with a greeting",
    state: "Todo"
  };
  
  const prompt = workflow.promptTemplate
    .replace(/\{\{identifier\}\}/g, issue.identifier)
    .replace(/\{\{title\}\}/g, issue.title)
    .replace(/\{\{description\}\}/g, issue.description || "")
    .replace(/\{\{state\}\}/g, issue.state);
  
  console.log("[test] Full prompt:");
  console.log(prompt);
  console.log("\n[test] Running agent with this prompt...");
  
  const runner = new AgentRunner(config);
  const program = runner.run(workspace, prompt, issue);
  
  const events = await Effect.runPromise(program);
  console.log("[test] Events:", events);
  
  // Check workspace
  const fs = await import("fs");
  const files = fs.readdirSync(workspace);
  console.log("[test] Files in workspace:", files);
}

main().catch(console.error);
