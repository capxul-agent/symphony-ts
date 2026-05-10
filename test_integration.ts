import { Orchestrator, makeConfig } from "./src/orchestrator.js";

async function main() {
  const config = makeConfig();
  console.log("Config:", { 
    projectSlug: config.linearProjectSlug,
    workspaceRoot: config.workspaceRoot,
    dashboardPort: config.dashboardPort
  });
  
  const orchestrator = new Orchestrator(config, "./WORKFLOW.md");
  
  // Just test that we can instantiate and start (won't run agent)
  console.log("[test] Orchestrator created successfully");
  
  // Test Linear connection
  const { LinearClient } = await import("./src/orchestrator.js");
  const client = new LinearClient(config.linearApiKey);
  
  try {
    const issues = await client.fetchCandidateIssues(config.linearProjectSlug, ["Todo", "In Progress", "In Review"]);
    console.log(`[test] Found ${issues.length} issues in Linear`);
    if (issues.length > 0) {
      console.log("[test] First issue:", issues[0].identifier, issues[0].title, issues[0].state);
    }
  } catch (e) {
    console.error("[test] Linear fetch failed:", e);
  }
}

main().catch(console.error);
