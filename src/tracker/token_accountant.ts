import { Effect } from "effect";
import { z } from "zod";
import { appendFileSync, existsSync, readFileSync } from "fs";

// ─── Domain ───

export const TokenUsageSchema = z.object({
  input_tokens: z.number().int().min(0).optional(),
  output_tokens: z.number().int().min(0).optional(),
  total_tokens: z.number().int().min(0).optional(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const TokenRecordSchema = z.object({
  timestamp: z.string(),
  issueId: z.string(),
  runId: z.string(),
  usage: TokenUsageSchema,
});

export type TokenRecord = z.infer<typeof TokenRecordSchema>;

// ─── Token Accountant ───

export interface TokenAccountant {
  readonly record: (issueId: string, runId: string, usage: TokenUsage) => Effect.Effect<void>;
  readonly parseKimiOutput: (output: string) => TokenUsage;
  readonly getTotals: (workspacePath: string) => Effect.Effect<{
    perRun: Record<string, TokenUsage>;
    perIssue: Record<string, TokenUsage>;
    total: TokenUsage;
  }>;
}

export function createTokenAccountant(): TokenAccountant {
  return {
    record: (issueId, runId, usage) =>
      Effect.sync(() => {
        const record: TokenRecord = {
          timestamp: new Date().toISOString(),
          issueId,
          runId,
          usage,
        };

        const line = JSON.stringify(record) + "\n";
        appendFileSync("symphony-tokens.jsonl", line);
      }),

    parseKimiOutput: (output: string) => {
      const turnEndMatch = output.match(
        /TurnEnd\s*\(\s*total_tokens\s*=\s*(\d+)\s*,\s*input_tokens\s*=\s*(\d+)\s*,\s*output_tokens\s*=\s*(\d+)\s*\)/
      );

      if (turnEndMatch) {
        return {
          total_tokens: parseInt(turnEndMatch[1], 10),
          input_tokens: parseInt(turnEndMatch[2], 10),
          output_tokens: parseInt(turnEndMatch[3], 10),
        };
      }

      const totalMatch = output.match(/total_tokens\s*=\s*(\d+)/);
      const inputMatch = output.match(/input_tokens\s*=\s*(\d+)/);
      const outputMatch = output.match(/output_tokens\s*=\s*(\d+)/);

      return {
        total_tokens: totalMatch ? parseInt(totalMatch[1], 10) : undefined,
        input_tokens: inputMatch ? parseInt(inputMatch[1], 10) : undefined,
        output_tokens: outputMatch ? parseInt(outputMatch[1], 10) : undefined,
      };
    },

    getTotals: (workspacePath: string) =>
      Effect.sync(() => {
        const perRun: Record<string, TokenUsage> = {};
        const perIssue: Record<string, TokenUsage> = {};
        let total: TokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

        const logPath = `${workspacePath}/.symphony/tokens.jsonl`;
        if (!existsSync(logPath)) {
          return { perRun, perIssue, total };
        }

        const lines = readFileSync(logPath, "utf-8").trim().split("\n");
        for (const line of lines) {
          if (!line) continue;
          try {
            const record = JSON.parse(line) as TokenRecord;
            const usage = record.usage;

            perRun[record.runId] = addUsage(perRun[record.runId], usage);
            perIssue[record.issueId] = addUsage(perIssue[record.issueId], usage);
            total = addUsage(total, usage);
          } catch {
            // Skip invalid lines
          }
        }

        return { perRun, perIssue, total };
      }),
  };
}

function addUsage(a: TokenUsage | undefined, b: TokenUsage): TokenUsage {
  return {
    input_tokens: (a?.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b.output_tokens ?? 0),
    total_tokens: (a?.total_tokens ?? 0) + (b.total_tokens ?? 0),
  };
}
