import { Effect } from "effect";
import { z } from "zod";

// ─── Domain ───

export const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(8793),
  host: z.string().default("0.0.0.0"),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// ─── State Snapshot ───

export interface OrchestratorSnapshot {
  running: Array<{
    issueId: string;
    identifier: string;
    state: string;
    workerHost?: string;
    workspacePath?: string;
    sessionId?: string;
    codexInputTokens: number;
    codexOutputTokens: number;
    codexTotalTokens: number;
    turnCount: number;
    startedAt: string;
    lastCodexTimestamp?: string;
    lastCodexMessage?: string;
    runtimeSeconds: number;
  }>;
  retrying: Array<{
    issueId: string;
    attempt: number;
    dueInMs: number;
    identifier?: string;
    error?: string;
    workerHost?: string;
    workspacePath?: string;
  }>;
  codexTotals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    secondsRunning: number;
  };
  polling: {
    checking: boolean;
    nextPollInMs: number | null;
    pollIntervalMs: number;
  };
}

// ─── Server ───

export interface Server {
  readonly start: () => Effect.Effect<void>;
  readonly stop: () => Effect.Effect<void>;
  readonly isRunning: () => boolean;
}

export function createServer(
  config: ServerConfig,
  getSnapshot: () => OrchestratorSnapshot
): Server {
  let server: ReturnType<typeof Bun.serve> | null = null;

  const htmlDashboard = `<!DOCTYPE html>
<html>
<head>
  <title>Symphony Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #0a0a0a; color: #e0e0e0; }
    h1 { color: #fff; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 2rem 0; }
    .metric-card { background: #1a1a1a; padding: 1.5rem; border-radius: 8px; border: 1px solid #333; }
    .metric-label { color: #888; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .metric-value { font-size: 2rem; font-weight: 600; color: #fff; margin: 0.5rem 0; }
    .metric-detail { color: #666; font-size: 0.875rem; }
    .section { background: #1a1a1a; padding: 1.5rem; border-radius: 8px; border: 1px solid #333; margin: 1rem 0; }
    .section-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #333; }
    th { color: #888; font-weight: 500; }
    .status-badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem; }
    .status-running { background: #22c55e20; color: #22c55e; }
    .status-retrying { background: #f59e0b20; color: #f59e0b; }
    .empty-state { color: #666; font-style: italic; padding: 2rem; text-align: center; }
  </style>
</head>
<body>
  <h1>🔮 Symphony Operations Dashboard</h1>
  <p>Current state, retry pressure, token usage, and orchestration health.</p>
  
  <div class="metric-grid">
    <div class="metric-card">
      <div class="metric-label">Running</div>
      <div class="metric-value" id="running-count">0</div>
      <div class="metric-detail">Active issue sessions</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Retrying</div>
      <div class="metric-value" id="retrying-count">0</div>
      <div class="metric-detail">Issues waiting for retry</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Tokens</div>
      <div class="metric-value" id="total-tokens">0</div>
      <div class="metric-detail">In <span id="input-tokens">0</span> / Out <span id="output-tokens">0</span></div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Runtime</div>
      <div class="metric-value" id="runtime">0s</div>
      <div class="metric-detail">Total Codex runtime</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Running Sessions</div>
    <div id="running-table"></div>
  </div>

  <div class="section">
    <div class="section-title">Retry Queue</div>
    <div id="retrying-table"></div>
  </div>

  <script>
    async function refresh() {
      const res = await fetch('/api/v1/state');
      const data = await res.json();
      
      document.getElementById('running-count').textContent = data.running.length;
      document.getElementById('retrying-count').textContent = data.retrying.length;
      document.getElementById('total-tokens').textContent = data.codexTotals.totalTokens.toLocaleString();
      document.getElementById('input-tokens').textContent = data.codexTotals.inputTokens.toLocaleString();
      document.getElementById('output-tokens').textContent = data.codexTotals.outputTokens.toLocaleString();
      document.getElementById('runtime').textContent = data.codexTotals.secondsRunning + 's';
      
      const runningHtml = data.running.length === 0 
        ? '<div class="empty-state">No active sessions.</div>'
        : '<table><tr><th>Issue</th><th>State</th><th>Session</th><th>Runtime</th><th>Tokens</th></tr>' +
          data.running.map(r => 
            '<tr><td>' + r.identifier + '</td><td>' + r.state + '</td><td>' + (r.sessionId || 'n/a') + '</td><td>' + r.runtimeSeconds + 's</td><td>' + r.codexTotalTokens + '</td></tr>'
          ).join('') + '</table>';
      document.getElementById('running-table').innerHTML = runningHtml;
      
      const retryingHtml = data.retrying.length === 0
        ? '<div class="empty-state">No retrying issues.</div>'
        : '<table><tr><th>Issue</th><th>Attempt</th><th>Due In</th><th>Error</th></tr>' +
          data.retrying.map(r =>
            '<tr><td>' + (r.identifier || r.issueId) + '</td><td>' + r.attempt + '</td><td>' + Math.round(r.dueInMs / 1000) + 's</td><td>' + (r.error || '') + '</td></tr>'
          ).join('') + '</table>';
      document.getElementById('retrying-table').innerHTML = retryingHtml;
    }
    
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;

  return {
    start: () =>
      Effect.sync(() => {
        server = Bun.serve({
          port: config.port,
          hostname: config.host,
          routes: {
            "/": new Response(htmlDashboard, {
              headers: { "Content-Type": "text/html" },
            }),
            "/api/v1/state": {
              GET: () => {
                const snapshot = getSnapshot();
                return Response.json(snapshot);
              },
            },
            "/api/v1/issues/:id": {
              GET: (req) => {
                const id = req.params.id;
                const snapshot = getSnapshot();
                const issue = snapshot.running.find((r) => r.issueId === id || r.identifier === id);
                if (!issue) {
                  return new Response(JSON.stringify({ error: "Not found" }), {
                    status: 404,
                    headers: { "Content-Type": "application/json" },
                  });
                }
                return Response.json(issue);
              },
            },
            "/api/v1/refresh": {
              POST: () => {
                // Trigger immediate poll — caller provides this
                return Response.json({ queued: true, operations: ["poll", "reconcile"] });
              },
            },
          },
          fetch(req) {
            return new Response("Not Found", { status: 404 });
          },
        });

        console.log(`Symphony server running on http://${config.host}:${config.port}`);
      }),

    stop: () =>
      Effect.sync(() => {
        if (server) {
          server.stop();
          server = null;
          console.log("Symphony server stopped");
        }
      }),

    isRunning: () => server !== null,
  };
}
