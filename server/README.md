# ResQNet Crisis Triage Agent — Backend

This is the **agentic backend** for ResQNet, built for the **Rapid Agent** track. It runs the
multi-step crisis triage agent server-side, where the MongoDB Atlas driver and Arize
trace export actually work (neither can run in the browser).

The browser ([reporter.html](../reporter.html)) writes the incident to Firestore, then
calls this backend's `/api/triage`. The agent runs its steps and returns the result; the
browser saves the triage fields back to Firestore under the reporter's auth. If this
backend is unreachable, the browser falls back to its built-in client-side triage so the
demo never breaks.

## The agent

`runTriageAgent` ([agent.js](agent.js)) executes these steps and calls the three tools
defined in [agent-tools.js](agent-tools.js) — the same tools declared in
[`agent-config.json`](../agent-config.json) (Vertex AI Agent Builder format):

1. **search_incidents** — query MongoDB for similar resolved past incidents (context)
2. Build a history-aware prompt
3. **Gemini** (`gemini-2.5-flash` → `gemini-1.5-flash` → rules) for severity + reasoning
4. **get_volunteers** — match available volunteers by skill from MongoDB
5. **log_to_arize** — export a trace for observability (best-effort)
6. Persist the full decision to the `agent_decisions` MongoDB collection

## MongoDB Atlas setup

1. Create a free-tier cluster named **`resqnet-cluster`** at <https://www.mongodb.com/atlas>.
2. Create database **`resqnet`** with collections:
   - `incidents` — mirror of Firestore incidents (the agent searches history here)
   - `volunteers` — mirror of Firestore volunteers (the agent matches skills here)
   - `agent_decisions` — written by the agent on every triage
3. Add your IP to the Atlas network access allowlist and create a database user.
4. Copy the connection string into `MONGODB_URI` in `.env`.

> Seed `incidents`/`volunteers` by mirroring Firestore — the browser already calls
> `/api/sync-incident` on every new report, and `/api/triage` upserts the incoming
> incident before searching. For volunteers, import/export from Firestore or insert test docs.

## Run it

Requires **Node.js 18+** (uses the global `fetch`).

```bash
cd server
cp .env.example .env      # then fill in GEMINI_API_KEY, MONGODB_URI, ARIZE_API_KEY
npm install
npm start                 # → http://localhost:8787
```

Point the browser at it by setting `BACKEND_URL` in [../config.js](../config.js)
(defaults to `http://localhost:8787`).

## Endpoints

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `GET`  | `/health` | — | `{ ok: true }` |
| `POST` | `/api/sync-incident` | `{ id, ...incidentFields }` | `{ success }` |
| `POST` | `/api/triage` | `{ incidentId, type, description, voiceTranscript, location, coordinates, timestamp, status }` | `{ triage, similarIncidentsFound, suggestedVolunteers, agentSteps, agentLatencyMs }` |

## Security notes

- Secrets (`MONGODB_URI`, `ARIZE_API_KEY`, `GEMINI_API_KEY`) live only in `.env`, which is
  gitignored. They are **never** placed in the browser-served `config.js`.
- `log_to_arize` is best-effort and never throws — a failed trace export will not fail triage.
- Lock down `ALLOWED_ORIGINS` (CORS) to your deployed frontend origin in production.
