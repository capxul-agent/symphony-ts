#!/usr/bin/env bun
import { Effect } from "effect";
import { Command } from "commander";
import { makeConfig } from "./domain.js";
import { Orchestrator } from "./orchestrator.js";

const program = new Command();

program
  .name("symphony")
  .description("Symphony orchestrator for Linear-integrated agent workflows")
  .version("1.0.0");

program
  .command("start")
  .description("Start the orchestrator daemon")
  .option("-w, --workflow <path>", "Path to WORKFLOW.md", "./WORKFLOW.md")
  .action(async (options) => {
    const config = makeConfig();
    const orchestrator = new Orchestrator(config, options.workflow);
    
    const runtime = orchestrator.start().pipe(
      Effect.catchAll((e) => Effect.sync(() => {
        console.error("[symphony] Fatal error:", e);
        process.exit(1);
      }))
    );
    
    // Run in background
    Effect.runFork(runtime);
    
    process.on("SIGINT", () => {
      console.log("\n[symphony] Shutting down...");
      Effect.runFork(orchestrator.stop());
      setTimeout(() => process.exit(0), 1000);
    });
    
    // Keep process alive
    setInterval(() => {}, 1000);
  });

program
  .command("test")
  .description("Run a smoke test with CAP-32")
  .action(async () => {
    const config = makeConfig();
    const orchestrator = new Orchestrator(config, "./WORKFLOW.md");
    
    console.log("[test] Starting smoke test...");
    const program = orchestrator.start();
    await Effect.runPromise(program);
    
    const state = await Effect.runPromise(orchestrator.getState());
    console.log("[test] Final state:", Array.from(state.entries()));
    
    const fs = await import("fs");
    const filePath = `${config.workspaceRoot}/CAP-32/hello.txt`;
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      console.log("[test] ✓ Smoke test passed! File created:", content);
    } else {
      console.log("[test] ✗ Smoke test failed - file not created");
      process.exit(1);
    }
    
    // Stop after test
    await Effect.runPromise(orchestrator.stop());
  });

program.parse();
