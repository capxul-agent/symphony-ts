import { Effect } from "effect";
import { readFileSync, statSync } from "fs";
import { createHash } from "crypto";
import { loadWorkflow } from "../workflow.js";
import type { Workflow } from "../domain.js";

// ─── Workflow Store ─────────────────────────────────────────────────────────
// Elixir: SymphonyElixir.WorkflowStore (GenServer)
// TypeScript: Effect fiber with polling loop

export interface WorkflowStoreState {
  path: string;
  stamp: { mtime: number; size: number; hash: string };
  workflow: Workflow;
}

const POLL_INTERVAL_MS = 1_000;

export function makeWorkflowStore(initialPath: string) {
  return Effect.gen(function* () {
    // Load initial state
    const initial = loadWorkflowState(initialPath);
    if (initial._tag === "Left") {
      return yield* Effect.fail(initial.left);
    }
    let stateRef: WorkflowStoreState = initial.right;

    // Polling loop — mirrors GenServer handle_info(:poll)
    const pollFiber = yield* Effect.fork(
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(POLL_INTERVAL_MS);
          
          const currentPath = stateRef.path;
          const newState = reloadWorkflowState(currentPath, stateRef);
          if (newState._tag === "Right") {
            stateRef = newState.right;
          }
        }
      })
    );

    return {
      current: (): Workflow => stateRef.workflow,
      forceReload: (): Workflow => {
        const newState = loadWorkflowState(stateRef.path);
        if (newState._tag === "Right") {
          stateRef = newState.right;
          return newState.right.workflow;
        }
        return stateRef.workflow;
      },
      pollFiber,
    };
  });
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

function loadWorkflowState(path: string): { _tag: "Right"; right: WorkflowStoreState } | { _tag: "Left"; left: Error } {
  try {
    const workflow = loadWorkflowFromFile(path);
    const stamp = computeStamp(path);
    return { _tag: "Right", right: { path, stamp, workflow } };
  } catch (err) {
    return { _tag: "Left", left: err as Error };
  }
}

function reloadWorkflowState(path: string, state: WorkflowStoreState): { _tag: "Right"; right: WorkflowStoreState } | { _tag: "Left"; left: Error } {
  try {
    const newStamp = computeStamp(path);
    if (
      newStamp.mtime === state.stamp.mtime &&
      newStamp.size === state.stamp.size &&
      newStamp.hash === state.stamp.hash
    ) {
      return { _tag: "Right", right: state };
    }

    const workflow = loadWorkflowFromFile(path);
    return { _tag: "Right", right: { path, stamp: newStamp, workflow } };
  } catch (err) {
    return { _tag: "Left", left: err as Error };
  }
}

function computeStamp(path: string): { mtime: number; size: number; hash: string } {
  const stat = statSync(path);
  const content = readFileSync(path, "utf-8");
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  return {
    mtime: Math.floor(stat.mtimeMs / 1000),
    size: stat.size,
    hash,
  };
}

function loadWorkflowFromFile(path: string): Workflow {
  const result = loadWorkflow(path);
  // Synchronous execution for initialization
  let workflow: Workflow | null = null;
    let error: Error | null = null;
    
    Effect.runSync(result.pipe(
      Effect.match({
        onSuccess: (w) => { workflow = w; },
        onFailure: (e) => { error = e as unknown as Error; },
      })
    ));
  
  if (error) throw error;
  if (!workflow) throw new Error("Failed to load workflow");
  return workflow;
}
