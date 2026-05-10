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

  rawQuery(query: string, variables?: Record<string, unknown>): Effect.Effect<unknown, LinearError> {
    return Effect.tryPromise({
      try: async () => {
        return await this.client.request(query, variables || {});
      },
      catch: (e) => new LinearError(`GraphQL query failed: ${e}`),
    });
  }

  /** Update issue state by name (e.g., "In Review", "Done", "Canceled") */
  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    // First, find the state ID by name
    const statesQuery = gql`
      query($name: String!) {
        workflowStates(filter: { name: { eq: $name } }) {
          nodes { id name }
        }
      }
    `;
    const statesData = await this.client.request(statesQuery, { name: stateName }) as any;
    const state = statesData?.workflowStates?.nodes?.[0];
    if (!state) {
      throw new LinearError(`Workflow state "${stateName}" not found`);
    }

    // Update the issue
    const mutation = gql`
      mutation($issueId: String!, $stateId: String!) {
        issueUpdate(id: $issueId, input: { stateId: $stateId }) {
          success
          issue { id identifier state { name } }
        }
      }
    `;
    const result = await this.client.request(mutation, { issueId, stateId: state.id }) as any;
    if (!result?.issueUpdate?.success) {
      throw new LinearError(`Failed to update issue state to "${stateName}"`);
    }
  }
}
