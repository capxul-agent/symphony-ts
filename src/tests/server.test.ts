import { test, expect, describe } from "bun:test";
import { Effect } from "effect";
import { createServer } from "../server";

describe("HTTP Server", () => {
  test("should start and serve dashboard", async () => {
    const snapshot = {
      running: [],
      retrying: [],
      codexTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
      polling: { checking: false, nextPollInMs: 30000, pollIntervalMs: 30000 },
    };

    const server = createServer({ port: 9876, host: "127.0.0.1" }, () => snapshot);
    await Effect.runPromise(server.start());

    // Give server a moment to bind
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch("http://127.0.0.1:9876/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Symphony");

    await Effect.runPromise(server.stop());
  });

  test("should return JSON state", async () => {
    const snapshot = {
      running: [{
        issueId: "issue-1",
        identifier: "CAP-1",
        state: "In Progress",
        codexInputTokens: 100,
        codexOutputTokens: 50,
        codexTotalTokens: 150,
        turnCount: 1,
        startedAt: new Date().toISOString(),
        runtimeSeconds: 10,
      }],
      retrying: [],
      codexTotals: { inputTokens: 100, outputTokens: 50, totalTokens: 150, secondsRunning: 10 },
      polling: { checking: false, nextPollInMs: 30000, pollIntervalMs: 30000 },
    };

    const server = createServer({ port: 9877, host: "127.0.0.1" }, () => snapshot);
    await Effect.runPromise(server.start());
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch("http://127.0.0.1:9877/api/v1/state");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.running.length).toBe(1);
    expect(json.running[0].identifier).toBe("CAP-1");

    await Effect.runPromise(server.stop());
  });

  test("should return 404 for unknown issue", async () => {
    const snapshot = {
      running: [],
      retrying: [],
      codexTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
      polling: { checking: false, nextPollInMs: 30000, pollIntervalMs: 30000 },
    };

    const server = createServer({ port: 9878, host: "127.0.0.1" }, () => snapshot);
    await Effect.runPromise(server.start());
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch("http://127.0.0.1:9878/api/v1/issues/UNKNOWN");
    expect(res.status).toBe(404);

    await Effect.runPromise(server.stop());
  });

  test("should handle refresh endpoint", async () => {
    const snapshot = {
      running: [],
      retrying: [],
      codexTotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, secondsRunning: 0 },
      polling: { checking: false, nextPollInMs: 30000, pollIntervalMs: 30000 },
    };

    const server = createServer({ port: 9879, host: "127.0.0.1" }, () => snapshot);
    await Effect.runPromise(server.start());
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch("http://127.0.0.1:9879/api/v1/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queued).toBe(true);

    await Effect.runPromise(server.stop());
  });
});
