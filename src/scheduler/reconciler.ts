import { Effect } from "effect";
import { z } from "zod";

// ─── Domain ───

export const ReconcilerStateSchema = z.object({
  running: z.record(z.object({
    issueId: z.string(),
    identifier: z.string(),
    state: z.string(),
    process: z.any().optional(), // ChildProcess
  })),
  terminalStates: z.array(z.string()),
  activeStates: z.array(z.string()),
});

export type ReconcilerState = z.infer<typeof ReconcilerStateSchema>;

// ─── Reconciler ───

export interface Reconciler {
  readonly reconcile: (
    linearIssues: Array<{ id: string; state: string }>,
    activeRuns: ReconcilerState["running"]
  ) => Effect.Effect<{
    toStop: string[];      // issueIds to stop
    toCleanup: string[];   // issueIds to cleanup
    toRefresh: string[];  // issueIds to refresh state
  }>;
  readonly isTerminalState: (state: string) => boolean;
}

export function createReconciler(
  terminalStates: string[],
  activeStates: string[]
): Reconciler {
  const terminalSet = new Set(terminalStates.map((s) => s.toLowerCase()));
  const activeSet = new Set(activeStates.map((s) => s.toLowerCase()));

  return {
    reconcile: (linearIssues, activeRuns) =>
      Effect.sync(() => {
        const toStop: string[] = [];
        const toCleanup: string[] = [];
        const toRefresh: string[] = [];

        const visibleIssueIds = new Set(linearIssues.map((i) => i.id));

        for (const [issueId, run] of Object.entries(activeRuns)) {
          const linearIssue = linearIssues.find((i) => i.id === issueId);

          if (!linearIssue) {
            // Issue no longer visible — stop and cleanup
            toStop.push(issueId);
            toCleanup.push(issueId);
            continue;
          }

          const normalizedState = linearIssue.state.toLowerCase().trim();

          if (terminalSet.has(normalizedState)) {
            // Issue moved to terminal state — stop and cleanup
            toStop.push(issueId);
            toCleanup.push(issueId);
          } else if (!activeSet.has(normalizedState)) {
            // Issue moved to non-active state — stop
            toStop.push(issueId);
          } else {
            // Still active — refresh state
            toRefresh.push(issueId);
          }
        }

        return { toStop, toCleanup, toRefresh };
      }),

    isTerminalState: (state: string) =>
      terminalSet.has(state.toLowerCase().trim()),
  };
}
