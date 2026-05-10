import { test, expect, describe } from "bun:test";
import { Effect } from "effect";
import { createLinearGraphqlTool, LinearGraphqlInputSchema } from "../agent/tools/linear_graphql";

describe("Linear GraphQL Tool", () => {
  test("should validate input schema", () => {
    const valid = { query: "{ issues { nodes { id } } }" };
    const result = LinearGraphqlInputSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test("should reject missing query", () => {
    const invalid = { variables: {} };
    const result = LinearGraphqlInputSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test("should execute tool and return JSON", async () => {
    const mockClient = (query: string, variables?: Record<string, unknown>) =>
      Effect.sync(() => ({ data: { issues: [] } }));

    const tool = createLinearGraphqlTool(mockClient);
    const result = await Effect.runPromise(
      tool.execute({ query: "{ issues { nodes { id } } }" })
    );

    expect(result).toContain("issues");
    expect(JSON.parse(result)).toEqual({ data: { issues: [] } });
  });

  test("should pass variables to client", async () => {
    let capturedVars: Record<string, unknown> | undefined;
    const mockClient = (query: string, variables?: Record<string, unknown>) =>
      Effect.sync(() => {
        capturedVars = variables;
        return { data: null };
      });

    const tool = createLinearGraphqlTool(mockClient);
    await Effect.runPromise(
      tool.execute({
        query: "mutation($id: String!) { updateIssue(id: $id) { id } }",
        variables: { id: "issue-1" },
      })
    );

    expect(capturedVars).toEqual({ id: "issue-1" });
  });
});
