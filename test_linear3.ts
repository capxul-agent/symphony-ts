import { Effect } from "effect";
import { LinearClient } from "./src/linear.js";

async function test() {
  const key = process.env.LINEAR_API_KEY || "";
  const client = new LinearClient(key);
  const program = client.fetchCandidateIssues("8e254c24eebe", ["Todo", "In Progress"]);
  
  const result = await Effect.runPromise(program);
  console.log("[test] Issues count:", result.length);
  for (const issue of result) {
    console.log(`  - ${issue.identifier}: ${issue.title} (${issue.state})`);
  }
}

test().catch(console.error);
