import { GraphQLClient, gql } from "graphql-request";

const ENDPOINT = "https://api.linear.app/graphql";
const API_KEY = process.env.LINEAR_API_KEY || "";

async function main() {
  const client = new GraphQLClient(ENDPOINT, {
    headers: { Authorization: API_KEY },
  });

  // Get team ID
  const teamsQuery = gql`
    query {
      teams {
        nodes { id name }
      }
    }
  `;
  
  const teamsData = await client.request(teamsQuery) as any;
  const teamId = teamsData.teams.nodes[0]?.id;
  console.log("Team ID:", teamId, teamsData.teams.nodes[0]?.name);

  // Get project ID from slug
  const projectQuery = gql`
    query($slug: String!) {
      projects(filter: { slugId: { eq: $slug } }) {
        nodes { id name }
      }
    }
  `;
  
  const projectData = await client.request(projectQuery, { slug: "8e254c24eebe" }) as any;
  const projectId = projectData.projects.nodes[0]?.id;
  console.log("Project ID:", projectId);

  // Get states for the project
  const statesQuery = gql`
    query {
      workflowStates {
        nodes { id name }
      }
    }
  `;
  
  const statesData = await client.request(statesQuery) as any;
  const todoState = statesData.workflowStates.nodes.find((s: any) => s.name === "Todo");
  console.log("Todo state ID:", todoState?.id);

  // Create issue
  const createMutation = gql`
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title state { name } }
      }
    }
  `;

  const result = await client.request(createMutation, {
    input: {
      title: "Symphony E2E: Create a greeting file",
      description: "Create a file called `greeting.txt` in the workspace root with the content 'Hello from Symphony!'",
      teamId,
      projectId,
      stateId: todoState?.id,
    }
  }) as any;

  console.log("Created issue:", result.issueCreate.issue);
}

main().catch(console.error);
