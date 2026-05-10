import { Effect } from "effect";
import { execSync } from "child_process";

// ─── GitHub PR Types ────────────────────────────────────────────────────────

export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly merged: boolean;
  readonly url: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly author: { readonly login: string };
  readonly reviewers: ReadonlyArray<{ readonly login: string; readonly state: string }>;
}

export interface GitHubError {
  readonly _tag: "GitHubError";
  readonly message: string;
}

export const GitHubError = (message: string): GitHubError => ({
  _tag: "GitHubError",
  message,
});

// ─── GitHub Client ──────────────────────────────────────────────────────────

export class GitHubClient {
  constructor(private token?: string) {}

  private runGh(args: string[]): string {
    const env = this.token
      ? { ...process.env, GH_TOKEN: this.token }
      : process.env;
    return execSync(`gh ${args.join(" ")}`, {
      env,
      encoding: "utf-8",
      timeout: 30000,
    }).trim();
  }

  /** Find PR for a given branch in the current repo */
  findPrForBranch(branch: string): Effect.Effect<PullRequest | null, GitHubError> {
    return Effect.try({
      try: () => {
        const json = this.runGh([
          "pr", "list",
          "--head", branch,
          "--json", "number,title,state,merged,url,headRefName,baseRefName,author,reviewRequests",
          "--state", "all",
        ]);
        if (!json || json === "[]") return null;
        const prs = JSON.parse(json) as Array<{
          number: number;
          title: string;
          state: string;
          merged: boolean;
          url: string;
          headRefName: string;
          baseRefName: string;
          author: { login: string };
          reviewRequests: Array<{ login: string; state: string }>;
        }>;
        if (prs.length === 0) return null;
        const pr = prs[0];
        return {
          number: pr.number,
          title: pr.title,
          state: pr.state as "OPEN" | "CLOSED" | "MERGED",
          merged: pr.merged,
          url: pr.url,
          headRefName: pr.headRefName,
          baseRefName: pr.baseRefName,
          author: pr.author,
          reviewers: pr.reviewRequests || [],
        };
      },
      catch: (e) => GitHubError(String(e)),
    });
  }

  /** Check PR status by number */
  getPrStatus(prNumber: number): Effect.Effect<PullRequest, GitHubError> {
    return Effect.try({
      try: () => {
        const json = this.runGh([
          "pr", "view", String(prNumber),
          "--json", "number,title,state,merged,url,headRefName,baseRefName,author,reviewRequests",
        ]);
        const pr = JSON.parse(json);
        return {
          number: pr.number,
          title: pr.title,
          state: pr.state as "OPEN" | "CLOSED" | "MERGED",
          merged: pr.merged,
          url: pr.url,
          headRefName: pr.headRefName,
          baseRefName: pr.baseRefName,
          author: pr.author,
          reviewers: pr.reviewRequests || [],
        };
      },
      catch: (e) => GitHubError(String(e)),
    });
  }

  /** Assign reviewer to PR */
  assignReviewer(prNumber: number, reviewer: string): Effect.Effect<void, GitHubError> {
    return Effect.try({
      try: () => {
        this.runGh(["pr", "edit", String(prNumber), "--add-reviewer", reviewer]);
      },
      catch: (e) => GitHubError(String(e)),
    });
  }

  /** Merge PR (squash) */
  mergePr(prNumber: number): Effect.Effect<void, GitHubError> {
    return Effect.try({
      try: () => {
        this.runGh(["pr", "merge", String(prNumber), "--squash", "--auto"]);
      },
      catch: (e) => GitHubError(String(e)),
    });
  }

  /** Delete branch after merge */
  deleteBranch(branch: string): Effect.Effect<void, GitHubError> {
    return Effect.try({
      try: () => {
        this.runGh(["api", "-X", "DELETE", `/repos/{owner}/{repo}/git/refs/heads/${branch}`]);
      },
      catch: (e) => GitHubError(String(e)),
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}
