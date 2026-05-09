import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect } from "effect";
import { existsSync, readFileSync, rmSync, readdirSync } from "fs";
import { makeConfig } from "../domain.js";
import { Orchestrator } from "../orchestrator.js";

describe("Symphony E2E Smoke Test", () => {
  const config = makeConfig();
  const orchestrator = new Orchestrator(config, "./WORKFLOW.md");
  const workspacePath = `/home/abuusama/symphony-ts/workspaces/CAP-32`;

  beforeAll(async () => {
    // Clean up workspace
    if (existsSync(workspacePath)) {
      const files = readdirSync(workspacePath);
      for (const file of files) {
        if (file !== ".git") {
          rmSync(`${workspacePath}/${file}`, { recursive: true, force: true });
        }
      }
    }
  });

  it("should find a candidate issue in Linear and complete the work", async () => {
    const program = orchestrator.start();
    await Effect.runPromise(program);
    
    const state = await Effect.runPromise(orchestrator.getState());
    expect(state.size).toBeGreaterThan(0);
    
    const worker = Array.from(state.values())[0];
    expect(worker.status).toBe("completed");
    
    // Verify workspace has files
    expect(existsSync(workspacePath)).toBe(true);
    const files = readdirSync(workspacePath).filter(f => f !== ".git");
    expect(files.length).toBeGreaterThan(0);
    
    // Check for hello or symphony file
    const targetFiles = files.filter((f: string) => 
      f.toLowerCase().includes("hello") || 
      f.toLowerCase().includes("symphony") ||
      f.toLowerCase().includes("test")
    );
    expect(targetFiles.length).toBeGreaterThan(0);
    
    const content = readFileSync(`${workspacePath}/${targetFiles[0]}`, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await Effect.runPromise(orchestrator.stop());
  });
});
