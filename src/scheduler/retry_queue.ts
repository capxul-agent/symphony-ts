import { Effect } from "effect";
import { z } from "zod";
import { logInfo } from "../logging";

// ─── Domain ───

export const RetryEntrySchema = z.object({
  issueId: z.string(),
  attempt: z.number().int().min(1),
  dueAt: z.number(), // monotonic time ms
  error: z.string().optional(),
});

export type RetryEntry = z.infer<typeof RetryEntrySchema>;

// ─── Constants ───

const BASE_DELAY_MS = 10_000;
const MAX_DELAY_MS = 60_000;
const MAX_RETRIES = 5;

// ─── Helpers ───

function computeBackoff(attempt: number): number {
  const power = Math.min(attempt - 1, 10);
  return Math.min(BASE_DELAY_MS * Math.pow(2, power), MAX_DELAY_MS);
}

// ─── Retry Queue ───

export interface RetryQueue {
  readonly add: (
    issueId: string,
    attempt: number,
    error?: string
  ) => Effect.Effect<void>;
  readonly next: () => Effect.Effect<RetryEntry | null>;
  readonly remove: (issueId: string) => Effect.Effect<void>;
  readonly list: () => Effect.Effect<RetryEntry[]>;
  readonly size: () => Effect.Effect<number>;
}

export function createRetryQueue(): RetryQueue {
  const entries = new Map<string, RetryEntry>();

  return {
    add: (issueId, attempt, error) =>
      Effect.sync(() => {
        const now = performance.now();
        const delay = computeBackoff(attempt);
        const entry: RetryEntry = {
          issueId,
          attempt,
          dueAt: now + delay,
          error,
        };
        entries.set(issueId, entry);
      }),

    next: () =>
      Effect.sync(() => {
        const now = performance.now();
        let next: RetryEntry | null = null;
        const values = Array.from(entries.values());
        for (const entry of values) {
          if (entry.dueAt <= now) {
            if (!next || entry.dueAt < next.dueAt) {
              next = entry;
            }
          }
        }
        return next;
      }),

    remove: (issueId) =>
      Effect.sync(() => {
        entries.delete(issueId);
      }),

    list: () =>
      Effect.sync(() =>
        Array.from(entries.values()).sort((a, b) => a.dueAt - b.dueAt)
      ),

    size: () => Effect.sync(() => entries.size),
  };
}

// ─── Retry Policy ───

export function shouldRetry(attempt: number): boolean {
  return attempt <= MAX_RETRIES;
}

export function isMaxRetriesReached(attempt: number): boolean {
  return attempt > MAX_RETRIES;
}
