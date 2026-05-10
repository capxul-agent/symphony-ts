import { Effect } from "effect";
import { mkdirSync, existsSync, rmSync } from "fs";
import { join, resolve } from "path";

export class WorkspaceError {
  readonly _tag = "WorkspaceError";
  constructor(readonly message: string) {}
}

export class WorkspaceManager {
  constructor(private root: string) {
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
  }

  getWorkspacePath(issueIdentifier: string): string {
    const sanitized = issueIdentifier.replace(/[^A-Za-z0-9._-]/g, "_");
    return resolve(join(this.root, sanitized));
  }

  ensureWorkspace(issueIdentifier: string): Effect.Effect<string, WorkspaceError> {
    return Effect.sync(() => {
      const path = this.getWorkspacePath(issueIdentifier);
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
      return path;
    }).pipe(
      Effect.catchAll((e) => Effect.fail(new WorkspaceError(`Failed to create workspace: ${e}`)))
    );
  }

  cleanup(issueIdentifier: string): Effect.Effect<void, WorkspaceError> {
    return Effect.sync(() => {
      const path = this.getWorkspacePath(issueIdentifier);
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
      }
    }).pipe(
      Effect.catchAll((e) => Effect.fail(new WorkspaceError(`Failed to cleanup workspace: ${e}`)))
    );
  }
}
