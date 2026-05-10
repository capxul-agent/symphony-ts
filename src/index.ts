#!/usr/bin/env node
import { Command } from "commander";
import { makeConfig } from "./orchestrator.js";
import { Orchestrator } from "./orchestrator.js";
import * as dotenv from "dotenv";

dotenv.config();

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
    
    await orchestrator.start();
    
    process.on("SIGINT", async () => {
      console.log("\n[symphony] Shutting down...");
      await orchestrator.stop();
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
    await orchestrator.start();
    
    const state = orchestrator.getState();
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
    await orchestrator.stop();
  });

program.parse();
