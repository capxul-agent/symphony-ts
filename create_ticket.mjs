// Create a test ticket in Linear for end-to-end testing
import { GraphQLClient, gql } from "graphql-request";

const LINEAR_API_KEY = process.env.LINEAR_API_KEY || "";
const PROJECT_SLUG = "8e254c24eebe";

const client = new GraphQLClient("https://api.linear.app/graphql", {
  headers: { Authorization: LINEAR_API_KEY },
});

async function createIssue() {
  // Get project ID
  const projectQuery = gql`
    query($slug: String!) {
      projects(filter: { slugId: { eq: $slug } }) {
        nodes {
          id
          name
        }
      }
    }
  `;
  
  const projectResult = await client.request(projectQuery, { slug: PROJECT_SLUG });
  const project = projectResult.projects.nodes[0];
  console.log("Project:", project.name);
  
  // Get team ID (required for Linear)
  const teamsQuery = gql`
    query {
      teams(first: 10) {
        nodes {
          id
          name
        }
      }
    }
  `;
  
  const teams = await client.request(teamsQuery);
  const team = teams.teams.nodes[0];
  
  if (!team) {
    console.error("No teams found");
    return;
  }
  
  console.log("Team:", team.name);
  const statesQuery = gql`
    query {
      workflowStates(first: 10) {
        nodes {
          id
          name
        }
      }
    }
  `;
  
  const states = await client.request(statesQuery);
  const todoState = states.workflowStates.nodes.find((s) => s.name === "Todo");
  
  if (!todoState) {
    console.error("Todo state not found");
    console.log("Available states:", states.workflowStates.nodes.map((s) => s.name));
    return;
  }
  
  // Create issue
  const createMutation = gql`
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          state {
            name
          }
        }
      }
    }
  `;
  
  const result = await client.request(createMutation, {
    input: {
      title: "Add retry queue visualization to dashboard",
      description: `## Objective
Add a visual representation of the retry queue to the Symphony dashboard so operators can see which issues are waiting and when they'll be retried.

## Requirements
1. Show retry queue as a table/list in the dashboard
2. Display: issue identifier, attempt count, time until retry, last error
3. Auto-refresh every 5 seconds
4. Use the existing /api/v1/state endpoint (already includes retrying array)

## Acceptance Criteria
- [ ] Dashboard shows retrying issues in a dedicated section
- [ ] Each retry entry shows: identifier, attempt number, due in (seconds), error message
- [ ] Section updates automatically via the existing 5s polling
- [ ] Empty state shows "No retrying issues" when queue is empty

## Notes
This is a frontend-only change. The backend already exposes retry data via the snapshot API. Just need to render it in the HTML dashboard.

## Testing
1. Start orchestrator with a failing agent to trigger retries
2. Verify retry entries appear in dashboard
3. Verify they disappear when retry succeeds or max retries reached`,
      teamId: team.id,
      projectId: project.id,
      stateId: todoState.id,
      labelIds: [],
    },
  });
  
  if (result.issueCreate.success) {
    console.log("✅ Created issue:", result.issueCreate.issue.identifier);
    console.log("   Title:", result.issueCreate.issue.title);
    console.log("   State:", result.issueCreate.issue.state.name);
    console.log("   URL: https://linear.app/capxul/issue/" + result.issueCreate.issue.identifier);
  } else {
    console.error("Failed to create issue");
  }
}

createIssue().catch(console.error);
