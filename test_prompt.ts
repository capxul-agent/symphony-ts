import { Effect } from "effect";
import { loadWorkflow } from "./src/workflow.js";

async function main() {
  const workflow = await Effect.runPromise(loadWorkflow("./WORKFLOW.md"));
  console.log("[test] Workflow config:", JSON.stringify(workflow.config, null, 2));
  console.log("[test] Prompt template preview:", workflow.promptTemplate.substring(0, 200));
  
  // Simulate what orchestrator does
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
  
  console.log("[test] Rendered prompt preview:", prompt.substring(0, 300));
}

main().catch(console.error);
