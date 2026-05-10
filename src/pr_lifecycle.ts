import { Effect } from "effect";
import { GitHubClient, type PullRequest } from "./github";
import { LinearClient } from "./linear";

// ─── PR Lifecycle Manager ───────────────────────────────────────────────────

export interface PrLifecycleConfig {
  readonly reviewer: string;           // GitHub username to assign for review
  readonly pollIntervalMs: number;     // How often to check PR status
  readonly maxPollDurationMs: number;  // Give up after this long
}

export interface PrLifecycleState {
  readonly issueId: string;
  readonly issueIdentifier: string;
  readonly branchName: string;
  readonly prNumber: number | null;
  readonly prUrl: string | null;
  readonly status: "detecting_pr" | "reviewing" | "merged" | "closed" | "timeout";
  readonly startedAt: number;
  readonly lastCheckedAt: number | null;
}

export class PrLifecycleManager {
  private states = new Map<string, PrLifecycleState>();
  private github: GitHubClient;
  private linear: LinearClient;

  constructor(
    private config: PrLifecycleConfig,
    githubToken?: string,
    linearApiKey?: string,
  ) {
    this.github = new GitHubClient(githubToken);
    this.linear = new LinearClient(linearApiKey || "");
  }

  /** Start tracking PR lifecycle for an issue after agent completes */
  startTracking(issueId: string, issueIdentifier: string, branchName: string): void {
    this.states.set(issueId, {
      issueId,
      issueIdentifier,
      branchName,
      prNumber: null,
      prUrl: null,
      status: "detecting_pr",
      startedAt: Date.now(),
      lastCheckedAt: null,
    });
  }

  /** Poll all tracked issues — call this from orchestrator tick */
  async pollAll(): Promise<void> {
    const entries = Array.from(this.states.entries());
    for (const [issueId, state] of entries) {
      if (state.status === "merged" || state.status === "closed" || state.status === "timeout") {
        continue; // Terminal — will be cleaned up by reconciler
      }

      const now = Date.now();
      if (now - state.startedAt > this.config.maxPollDurationMs) {
        console.log(`[pr-lifecycle] ${issueId}: Max poll duration reached, marking timeout`);
        this.states.set(issueId, { ...state, status: "timeout" });
        continue;
      }

      await this.pollIssue(issueId, state);
    }
  }

  private async pollIssue(issueId: string, state: PrLifecycleState): Promise<void> {
    try {
      if (state.status === "detecting_pr") {
        // Look for PR created by agent
        const pr = await Effect.runPromise(this.github.findPrForBranch(state.branchName));
        if (pr) {
          console.log(`[pr-lifecycle] ${state.issueIdentifier}: Found PR #${pr.number} — ${pr.url}`);
          
          // Assign reviewer
          await Effect.runPromise(this.github.assignReviewer(pr.number, this.config.reviewer));
          console.log(`[pr-lifecycle] ${state.issueIdentifier}: Assigned reviewer ${this.config.reviewer}`);

          // Update Linear to "In Review"
          await this.linear.updateIssueState(issueId, "In Review");
          console.log(`[pr-lifecycle] ${state.issueIdentifier}: Updated Linear → In Review`);

          this.states.set(issueId, {
            ...state,
            prNumber: pr.number,
            prUrl: pr.url,
            status: "reviewing",
            lastCheckedAt: Date.now(),
          });
        } else {
          console.log(`[pr-lifecycle] ${state.issueIdentifier}: No PR found for branch ${state.branchName}`);
          this.states.set(issueId, { ...state, lastCheckedAt: Date.now() });
        }
      } else if (state.status === "reviewing" && state.prNumber) {
        // Check if PR merged or closed
        const pr = await Effect.runPromise(this.github.getPrStatus(state.prNumber));
        console.log(`[pr-lifecycle] ${state.issueIdentifier}: PR #${pr.number} status = ${pr.state}`);

        if (pr.state === "MERGED") {
          console.log(`[pr-lifecycle] ${state.issueIdentifier}: PR merged!`);
          
          // Update Linear to "Done"
          await this.linear.updateIssueState(issueId, "Done");
          console.log(`[pr-lifecycle] ${state.issueIdentifier}: Updated Linear → Done`);

          // Delete branch
          try {
            await Effect.runPromise(this.github.deleteBranch(state.branchName));
            console.log(`[pr-lifecycle] ${state.issueIdentifier}: Deleted branch ${state.branchName}`);
          } catch (e) {
            console.log(`[pr-lifecycle] ${state.issueIdentifier}: Branch cleanup failed (may already be deleted)`);
          }

          this.states.set(issueId, { ...state, status: "merged", lastCheckedAt: Date.now() });
        } else if (pr.state === "CLOSED") {
          console.log(`[pr-lifecycle] ${state.issueIdentifier}: PR closed without merge`);
          
          // Update Linear to "Canceled"
          await this.linear.updateIssueState(issueId, "Canceled");
          console.log(`[pr-lifecycle] ${state.issueIdentifier}: Updated Linear → Canceled`);

          this.states.set(issueId, { ...state, status: "closed", lastCheckedAt: Date.now() });
        } else {
          // Still open — update last checked
          this.states.set(issueId, { ...state, lastCheckedAt: Date.now() });
        }
      }
    } catch (e) {
      console.error(`[pr-lifecycle] ${state.issueIdentifier}: Poll error:`, e);
      this.states.set(issueId, { ...state, lastCheckedAt: Date.now() });
    }
  }

  /** Get state for dashboard/API */
  getStates(): PrLifecycleState[] {
    return Array.from(this.states.values());
  }

  /** Check if issue is in terminal PR state (ready for cleanup) */
  isTerminal(issueId: string): boolean {
    const state = this.states.get(issueId);
    return state ? ["merged", "closed", "timeout"].includes(state.status) : false;
  }

  /** Remove tracking for an issue (after cleanup) */
  remove(issueId: string): void {
    this.states.delete(issueId);
  }
}
