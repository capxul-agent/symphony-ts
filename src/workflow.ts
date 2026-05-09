import { Effect, Either } from "effect";
import { readFileSync } from "fs";
import * as YAML from "yaml";
import type { Workflow, WorkflowConfig } from "./domain.js";

export class WorkflowError {
  readonly _tag = "WorkflowError";
  constructor(readonly message: string) {}
}

const parseYamlFrontMatter = (yaml: string): Either.Either<WorkflowConfig, WorkflowError> => {
  try {
    const parsed = YAML.parse(yaml) as WorkflowConfig;
    return Either.right(parsed);
  } catch (e) {
    return Either.left(new WorkflowError(`YAML parse error: ${e}`));
  }
};

export const loadWorkflow = (path: string): Effect.Effect<Workflow, WorkflowError> =>
  Effect.sync(() => {
    const content = readFileSync(path, "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      throw new WorkflowError("Invalid WORKFLOW.md: missing YAML front matter");
    }
    const config = parseYamlFrontMatter(match[1]);
    if (Either.isLeft(config)) {
      throw config.left;
    }
    return {
      config: config.right,
      promptTemplate: match[2].trim(),
    };
  }).pipe(
    Effect.catchAll((e) => Effect.fail(new WorkflowError(String(e))))
  );
