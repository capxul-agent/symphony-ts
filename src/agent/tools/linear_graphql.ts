import { Effect } from "effect";
import { z } from "zod";

// ─── Tool Schema ───

export const LinearGraphqlInputSchema = z.object({
  query: z.string(),
  variables: z.record(z.unknown()).optional(),
});

export type LinearGraphqlInput = z.infer<typeof LinearGraphqlInputSchema>;

// ─── Tool Definition ───

export const LINEAR_GRAPHQL_TOOL = {
  name: "linear_graphql",
  description: "Execute a raw GraphQL query or mutation against Linear using Symphony's configured auth.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description: "GraphQL query or mutation document to execute against Linear.",
      },
      variables: {
        type: ["object", "null"],
        description: "Optional GraphQL variables object.",
        additionalProperties: true,
      },
    },
  },
};

// ─── Tool Handler ───

export interface LinearGraphqlTool {
  readonly execute: (input: LinearGraphqlInput) => Effect.Effect<string>;
}

export function createLinearGraphqlTool(
  graphqlClient: (query: string, variables?: Record<string, unknown>) => Effect.Effect<unknown, any, never>
): LinearGraphqlTool {
  return {
    execute: (input) =>
      Effect.gen(function* () {
        const validated = LinearGraphqlInputSchema.parse(input);
        const response = yield* graphqlClient(validated.query, validated.variables);
        return JSON.stringify(response);
      }),
  };
}
