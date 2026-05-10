import { test, expect, describe } from "bun:test";
import { Effect } from "effect";
import { createPromptBuilder } from "../prompt_builder";
import { mkdirSync, rmSync, writeFileSync } from "fs";

describe("Prompt Builder", () => {
  test("should substitute issue variables", async () => {
    const builder = createPromptBuilder();
    const result = await Effect.runPromise(
      builder.build(
        {
          id: "abc",
          identifier: "CAP-42",
          title: "Fix the bug",
          description: "Something is broken",
          state: "Todo",
        },
        {
          tools: ["linear_graphql"],
          states: { todo: "Todo", done: "Done" },
        }
      )
    );

    expect(result).toContain("CAP-42");
    expect(result).toContain("Fix the bug");
    expect(result).toContain("Something is broken");
    expect(result).toContain("linear_graphql");
  });

  test("should handle missing description", async () => {
    const builder = createPromptBuilder();
    const result = await Effect.runPromise(
      builder.build(
        {
          id: "abc",
          identifier: "CAP-42",
          title: "Fix the bug",
          state: "Todo",
        },
        {
          tools: [],
          states: {},
        }
      )
    );

    expect(result).toContain("Fix the bug");
    expect(result).not.toContain("Description:");
  });

  test("should read from custom prompt file", async () => {
    const testDir = "/tmp/test-prompt";
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      `${testDir}/custom.md`,
      "Task: {{issue.title}}\nID: {{issue.identifier}}"
    );

    const builder = createPromptBuilder();
    const result = await Effect.runPromise(
      builder.build(
        {
          id: "abc",
          identifier: "CAP-99",
          title: "Custom task",
          state: "In Progress",
        },
        { tools: [], states: {} },
        `${testDir}/custom.md`
      )
    );

    expect(result).toContain("Custom task");
    expect(result).toContain("CAP-99");

    rmSync(testDir, { recursive: true });
  });
});
