import { Effect } from "effect";
import { z } from "zod";

// ─── Domain ───

export const HookConfigSchema = z.object({
  after_create: z.string().optional(),
  before_run: z.string().optional(),
  after_run: z.string().optional(),
  before_remove: z.string().optional(),
  timeout_ms: z.number().int().min(1000).default(300_000),
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

        const proc = Bun.spawn({
          cmd: ["/bin/sh", "-lc", command],
          cwd: workspacePath,
          env: { ...process.env, ...env },
          stdout: "pipe",
          stderr: "pipe",
        });

        // Wait for process to complete
        await proc.exited;

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = proc.exitCode ?? -1;

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
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const result = yield* hooks.execute(hookName, workspacePath, env);
    if (result.exitCode !== 0) {
      // Log warning but don't fail
      console.warn(
        `Hook ${hookName} failed with exit code ${result.exitCode}: ${result.stderr}`
      );
    }
  });
}
