import React from "react";
import { render, Text, Box } from "ink";
import type { OrchestratorState } from "./domain.js";

interface DashboardProps {
  state: OrchestratorState;
}

function Dashboard({ state }: DashboardProps) {
  const workers = Array.from(state.workers.entries());
  
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">Symphony Orchestrator</Text>
      <Text dimColor>Last poll: {state.lastPollTime || "never"}</Text>
      
      <Box marginTop={1}>
        <Text bold>Workers ({workers.length}):</Text>
      </Box>
      
      {workers.length === 0 ? (
        <Text dimColor>No active workers</Text>
      ) : (
        workers.map(([id, worker]) => (
          <Box key={id} marginLeft={2}>
            <Text>
              {worker.issueId} — <Text color={getStatusColor(worker.status)}>{worker.status}</Text>
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case "running": return "yellow";
    case "completed": return "green";
    case "failed": return "red";
    default: return "white";
  }
}

export function startDashboard(state: OrchestratorState) {
  render(<Dashboard state={state} />);
}
