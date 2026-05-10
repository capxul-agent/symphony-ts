import { test, expect, describe } from "bun:test";
import { Effect } from "effect";
import { createReconciler } from "../scheduler/reconciler";

describe("Reconciler", () => {
  test("should stop runs for terminal states", async () => {
    const reconciler = createReconciler(["done", "canceled"], ["todo", "in progress", "in review"]);
    
    const result = await Effect.runPromise(
      reconciler.reconcile(
        [{ id: "issue-1", state: "Done" }],
        {
          "issue-1": { issueId: "issue-1", identifier: "CAP-1", state: "In Progress" },
        }
      )
    );

    expect(result.toStop).toContain("issue-1");
    expect(result.toCleanup).toContain("issue-1");
    expect(result.toRefresh).toHaveLength(0);
  });

  test("should refresh active states", async () => {
    const reconciler = createReconciler(["done"], ["todo", "in progress"]);
    
    const result = await Effect.runPromise(
      reconciler.reconcile(
        [{ id: "issue-1", state: "In Progress" }],
        {
          "issue-1": { issueId: "issue-1", identifier: "CAP-1", state: "In Progress" },
        }
      )
    );

    expect(result.toStop).toHaveLength(0);
    expect(result.toCleanup).toHaveLength(0);
    expect(result.toRefresh).toContain("issue-1");
  });

  test("should stop for deleted issues", async () => {
    const reconciler = createReconciler(["done"], ["todo", "in progress"]);
    
    const result = await Effect.runPromise(
      reconciler.reconcile(
        [], // No issues returned
        {
          "issue-1": { issueId: "issue-1", identifier: "CAP-1", state: "In Progress" },
        }
      )
    );

    expect(result.toStop).toContain("issue-1");
    expect(result.toCleanup).toContain("issue-1");
  });

  test("should detect terminal state", () => {
    const reconciler = createReconciler(["done", "canceled"], ["todo"]);
    expect(reconciler.isTerminalState("Done")).toBe(true);
    expect(reconciler.isTerminalState("done")).toBe(true);
    expect(reconciler.isTerminalState("Todo")).toBe(false);
  });

  test("should stop for non-active non-terminal states", async () => {
    const reconciler = createReconciler(["done"], ["todo", "in progress"]);
    
    const result = await Effect.runPromise(
      reconciler.reconcile(
        [{ id: "issue-1", state: "Backlog" }], // Not active, not terminal
        {
          "issue-1": { issueId: "issue-1", identifier: "CAP-1", state: "In Progress" },
        }
      )
    );

    expect(result.toStop).toContain("issue-1");
    expect(result.toCleanup).toHaveLength(0); // Not terminal, don't cleanup
  });
});
