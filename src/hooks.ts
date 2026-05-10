import { Effect } from "effect";
import { z } from "zod";

// ─── Domain ───

export const HookConfigSchema = z.object({
  after_create: z.string().optional(),
  before_run: z.string().optional(),
  after_run: z.string().optional(),
  before_remove: z.string().optional(),
  timeout_ms: z.number().int().min(1000).optional().default(300_000),
});

export type HookConfig = z.infer<typeof HookConfigSchema>;

export type HookName = "after_create" | "before_run" | "after_run" | "before_remove";

// ─── Hooks ───

export interface Hooks {
  readonly execute: (
    hookName: HookName,
    workspacePath: string,
    env?: Record<string, string>
  ) => Effect.Effect<{ exitCode: number; stdout: string; stderr: string }>;
}

export function createHooks(config: HookConfig): Hooks {
  return {
    execute: (hookName, workspacePath, env = {}) =>
      Effect.promise(async () => {
        const command = config[hookName];
        if (!command) {
          return { exitCode: 0, stdout: "", stderr: "" };
        }

      const { spawn } = require("child_process");
      const proc = spawn("/bin/sh", ["-lc", command], {
        cwd: workspacePath,
        env: { ...process.env, ...env },
      });

      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
      proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

      const exitCode = await new Promise<number>((resolve) => {
        proc.on("close", (code: number | null) => resolve(code ?? -1));
      });

      return { exitCode, stdout, stderr };
      }),
  };
}

// ─── Hook runner with failure tolerance ───

export function runHook(
  hooks: Hooks,
  hookName: HookName,
  workspacePath: string,
  env?: Record<string, string>
): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    const result = yield* hooks.execute(hookName, workspacePath, env);
    if (result.exitCode !== 0) {
      // Log warning but don't fail
      console.warn(
        `Hook ${hookName} failed with exit code ${result.exitCode}: ${result.stderr}`
      );
    }
  }).pipe(Effect.catchAll(() => Effect.void));
}
