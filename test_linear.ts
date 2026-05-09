import { LinearClient } from "./src/linear.js";

async function test() {
  const key = process.env.LINEAR_API_KEY || "";
  console.log("[test] Key length:", key.length);
  console.log("[test] Key prefix:", key.substring(0, 20));
  
  const client = new LinearClient(key);
  const result = await client.fetchCandidateIssues("symphony-0c79b11b75ea", ["Todo", "In Progress"]);
  
  console.log("[test] Issues:", result);
}

test().catch(console.error);
