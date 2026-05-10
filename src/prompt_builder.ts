import { Effect } from "effect";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";

// ─── Domain ───

export const IssueContextSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().optional(),
  state: z.string(),
});

export type IssueContext = z.infer<typeof IssueContextSchema>;

export const WorkflowContextSchema = z.object({
  tools: z.array(z.string()),
  states: z.record(z.string(), z.string()),
});

export type WorkflowContext = z.infer<typeof WorkflowContextSchema>;

// ─── Prompt Builder ───

export interface PromptBuilder {
  readonly build: (
    issue: IssueContext,
    workflow: WorkflowContext,
    promptPath?: string
  ) => Effect.Effect<string>;
}

export function createPromptBuilder(): PromptBuilder {
  return {
    build: (issue, workflow, promptPath = ".symphony/prompt.md") =>
      Effect.sync(() => {
        // Read prompt template
        let template: string;
        if (existsSync(promptPath)) {
          template = readFileSync(promptPath, "utf-8");
        } else {
          // Default prompt
          template = `You are working on issue {{issue.identifier}}: {{issue.title}}

{{#if issue.description}}
Description: {{issue.description}}
{{/if}}

Available tools: {{workflow.tools}}

Current state: {{issue.state}}
Target states: {{workflow.states}}`;
        }

        // Simple Liquid-style substitution
        // {{issue.title}} -> issue.title value
        // {{workflow.tools}} -> JSON array
        let result = template;

        // Issue substitutions
        result = result.replace(/\{\{\s*issue\.id\s*\}\}/g, issue.id);
        result = result.replace(/\{\{\s*issue\.identifier\s*\}\}/g, issue.identifier);
        result = result.replace(/\{\{\s*issue\.title\s*\}\}/g, issue.title);
        result = result.replace(
          /\{\{\s*issue\.description\s*\}\}/g,
          issue.description || ""
        );
        result = result.replace(/\{\{\s*issue\.state\s*\}\}/g, issue.state);

        // Workflow substitutions
        result = result.replace(
          /\{\{\s*workflow\.tools\s*\}\}/g,
          JSON.stringify(workflow.tools)
        );
        result = result.replace(
          /\{\{\s*workflow\.states\s*\}\}/g,
          JSON.stringify(workflow.states)
        );

        // Conditional blocks: {{#if issue.description}}...{{/if}}
        result = result.replace(
          /\{\{\s*#if\s+issue\.description\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g,
          issue.description ? "$1" : ""
        );

        return result;
      }),
  };
}
