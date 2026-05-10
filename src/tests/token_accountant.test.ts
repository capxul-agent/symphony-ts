import { test, expect, describe } from "bun:test";
import { Effect } from "effect";
import { createTokenAccountant } from "../tracker/token_accountant";
import { mkdirSync, rmSync, writeFileSync } from "fs";

describe("Token Accountant", () => {
  test("should parse Kimi TurnEnd output", () => {
    const accountant = createTokenAccountant();
    const output = `Some text
TurnEnd(total_tokens=1500, input_tokens=1000, output_tokens=500)
More text`;

    const usage = accountant.parseKimiOutput(output);
    expect(usage.total_tokens).toBe(1500);
    expect(usage.input_tokens).toBe(1000);
    expect(usage.output_tokens).toBe(500);
  });

  test("should parse partial token output", () => {
    const accountant = createTokenAccountant();
    const output = `input_tokens=500 output_tokens=300`;

    const usage = accountant.parseKimiOutput(output);
    expect(usage.input_tokens).toBe(500);
    expect(usage.output_tokens).toBe(300);
    expect(usage.total_tokens).toBeUndefined();
  });

  test("should return empty for no tokens", () => {
    const accountant = createTokenAccountant();
    const usage = accountant.parseKimiOutput("Just regular text");
    expect(usage.total_tokens).toBeUndefined();
    expect(usage.input_tokens).toBeUndefined();
    expect(usage.output_tokens).toBeUndefined();
  });

  test("should record tokens", async () => {
    const accountant = createTokenAccountant();
    await Effect.runPromise(
      accountant.record("issue-1", "run-1", {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
      })
    );
    // Just verify it doesn't throw
    expect(true).toBe(true);
  });

  test("should accumulate totals from jsonl", async () => {
    const testDir = "/tmp/test-tokens";
    mkdirSync(`${testDir}/.symphony`, { recursive: true });

    const lines = [
      JSON.stringify({ timestamp: "2024-01-01", issueId: "issue-1", runId: "run-1", usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } }),
      JSON.stringify({ timestamp: "2024-01-01", issueId: "issue-1", runId: "run-2", usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 } }),
      JSON.stringify({ timestamp: "2024-01-01", issueId: "issue-2", runId: "run-3", usage: { input_tokens: 50, output_tokens: 25, total_tokens: 75 } }),
    ];
    writeFileSync(`${testDir}/.symphony/tokens.jsonl`, lines.join("\n"));

    const accountant = createTokenAccountant();
    const totals = await Effect.runPromise(accountant.getTotals(testDir));

    expect(totals.total.input_tokens).toBe(350);
    expect(totals.total.output_tokens).toBe(175);
    expect(totals.total.total_tokens).toBe(525);

    expect(totals.perIssue["issue-1"].input_tokens).toBe(300);
    expect(totals.perIssue["issue-2"].input_tokens).toBe(50);

    rmSync(testDir, { recursive: true });
  });
});
