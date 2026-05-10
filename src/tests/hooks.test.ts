import { test, expect, describe } from "bun:test";
import { Effect } from "effect";
import { createHooks, runHook } from "../hooks";
import { mkdirSync, rmSync } from "fs";

describe("Hooks", () => {
  const testDir = "/tmp/test-hooks";

  test("should execute after_create hook", async () => {
    mkdirSync(testDir, { recursive: true });
    const hooks = createHooks({
      after_create: "echo 'created' > hook.log",
    });

    const result = await Effect.runPromise(
      hooks.execute("after_create", testDir)
    );
    expect(result.exitCode).toBe(0);
    rmSync(testDir, { recursive: true });
  });

  test("should return success when hook not configured", async () => {
    const hooks = createHooks({});
    const result = await Effect.runPromise(
      hooks.execute("before_run", "/tmp")
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  test("should capture hook failure but not throw", async () => {
    const hooks = createHooks({
      before_run: "exit 1",
    });
    const result = await Effect.runPromise(
      hooks.execute("before_run", "/tmp")
    );
    expect(result.exitCode).toBe(1);
  });

  test("runHook should tolerate failure", async () => {
    const hooks = createHooks({
      after_run: "exit 1",
    });
    // Should not throw
    await Effect.runPromise(runHook(hooks, "after_run", "/tmp"));
  });
});
