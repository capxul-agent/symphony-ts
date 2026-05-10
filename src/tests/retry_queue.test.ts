import { test, expect, describe } from "bun:test";
import { Effect } from "effect";
import { createRetryQueue, shouldRetry, isMaxRetriesReached } from "../scheduler/retry_queue";

describe("Retry Queue", () => {
  test("should add entry and compute backoff", async () => {
    const queue = createRetryQueue();
    await Effect.runPromise(queue.add("issue-1", 1));
    const size = await Effect.runPromise(queue.size());
    expect(size).toBe(1);
  });

  test("should compute exponential backoff", async () => {
    const queue = createRetryQueue();
    await Effect.runPromise(queue.add("issue-1", 1));
    await Effect.runPromise(queue.add("issue-2", 2));
    await Effect.runPromise(queue.add("issue-3", 3));

    const list = await Effect.runPromise(queue.list());
    expect(list.length).toBe(3);
    // Due times should be spaced exponentially
    expect(list[1].dueAt - list[0].dueAt).toBeGreaterThan(0);
    expect(list[2].dueAt - list[1].dueAt).toBeGreaterThan(list[1].dueAt - list[0].dueAt);
  });

  test("should return next due entry", async () => {
    const queue = createRetryQueue();
    await Effect.runPromise(queue.add("issue-1", 1));
    // Wait for it to be due (backoff for attempt 1 is 10s)
    await new Promise((r) => setTimeout(r, 10500));
    const next = await Effect.runPromise(queue.next());
    expect(next).not.toBeNull();
    expect(next?.issueId).toBe("issue-1");
  }, 15000);

  test("should remove entry", async () => {
    const queue = createRetryQueue();
    await Effect.runPromise(queue.add("issue-1", 1));
    await Effect.runPromise(queue.remove("issue-1"));
    const size = await Effect.runPromise(queue.size());
    expect(size).toBe(0);
  });

  test("shouldRetry returns true for attempt <= 5", () => {
    expect(shouldRetry(1)).toBe(true);
    expect(shouldRetry(5)).toBe(true);
    expect(shouldRetry(6)).toBe(false);
  });

  test("isMaxRetriesReached returns true for attempt > 5", () => {
    expect(isMaxRetriesReached(5)).toBe(false);
    expect(isMaxRetriesReached(6)).toBe(true);
  });
});
