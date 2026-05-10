import { GraphQLClient, gql } from "graphql-request";

const ENDPOINT = "https://api.linear.app/graphql";
const API_KEY = process.env.LINEAR_API_KEY || "";

async function main() {
  const client = new GraphQLClient(ENDPOINT, {
    headers: { Authorization: API_KEY },
  });

  const query = gql`
    query {
      issues(filter: { project: { slugId: { eq: "8e254c24eebe" } } }) {
        nodes { id identifier title state { name } }
      }
    }
  `;
  
  const data = await client.request(query) as any;
  for (const issue of data.issues.nodes) {
    console.log(`${issue.identifier}: ${issue.title} [${issue.state.name}]`);
  }
}

main().catch(console.error);
