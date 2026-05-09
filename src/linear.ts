import { Effect } from "effect";
import { GraphQLClient, gql } from "graphql-request";
import type { Issue } from "./domain.js";

const ENDPOINT = "https://api.linear.app/graphql";

export class LinearError {
  readonly _tag = "LinearError";
  constructor(readonly message: string) {}
}

export class LinearClient {
  private client: GraphQLClient;

  constructor(apiKey: string) {
    this.client = new GraphQLClient(ENDPOINT, {
      headers: { Authorization: apiKey },
    });
  }

  fetchCandidateIssues(projectSlug: string, activeStates: string[]): Effect.Effect<Issue[], LinearError> {
    return Effect.tryPromise({
      try: async () => {
        const query = gql`
          query($projectSlug: String!, $states: [String!]!) {
            issues(
              filter: {
                project: { slugId: { eq: $projectSlug } }
                state: { name: { in: $states } }
              }
            ) {
              nodes {
                id
                identifier
                title
                description
                state { name }
                priority
                labels { nodes { name } }
                createdAt
                updatedAt
                url
              }
            }
          }
        `;
        const data = await this.client.request(query, { projectSlug, states: activeStates }) as any;
        return data.issues.nodes.map((node: any) => ({
          id: node.id,
          identifier: node.identifier,
          title: node.title,
          description: node.description || null,
          state: node.state.name,
          priority: node.priority ?? null,
          labels: node.labels?.nodes.map((l: any) => l.name.toLowerCase()) || [],
          branchName: null,
          url: node.url,
          blockedBy: [],
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
        }));
      },
      catch: (e) => new LinearError(`Failed to fetch issues: ${e}`),
    });
  }
}
