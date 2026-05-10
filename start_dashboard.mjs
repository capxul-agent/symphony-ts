import { Orchestrator, makeConfig } from "./dist/orchestrator.js";
import dotenv from "dotenv";

dotenv.config();

const orch = new Orchestrator(makeConfig(), "./WORKFLOW.md");
await orch.start();
console.log("Dashboard running at http://localhost:8793");
console.log("Press Ctrl+C to stop");
