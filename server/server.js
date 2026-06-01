import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { runTriageAgent } from './agent.js'
import { syncIncidentToMongo, getMongoClient } from './mongodb.js'

const app = express()
app.use(express.json({ limit: '256kb' }))

const allowed = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim())
app.use(
  cors({
    origin: allowed.includes('*') ? true : allowed
  })
)

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'resqnet-agent-server' })
})

/**
 * POST /api/sync-incident
 * Mirror a Firestore incident into MongoDB. Body: { id, ...incidentFields }
 */
app.post('/api/sync-incident', async (req, res) => {
  const incident = req.body
  if (!incident?.id) return res.status(400).json({ error: 'id is required' })
  try {
    await syncIncidentToMongo(incident)
    res.json({ success: true })
  } catch (err) {
    console.error('[Sync] failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/triage
 * Run the multi-step crisis triage agent.
 * Body: { incidentId, type, description, voiceTranscript, location, coordinates, timestamp, status }
 * Returns: { triage, similarIncidentsFound, suggestedVolunteers, agentSteps, agentLatencyMs }
 */
app.post('/api/triage', async (req, res) => {
  const { incidentId, type } = req.body || {}
  if (!incidentId || !type) {
    return res.status(400).json({ error: 'incidentId and type are required' })
  }
  try {
    const result = await runTriageAgent(req.body)
    res.json(result)
  } catch (err) {
    console.error('[Triage] failed:', err)
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 8787
app.listen(PORT, () => {
  console.log(`[Server] ResQNet agent backend listening on http://localhost:${PORT}`)
  // Warm the Mongo connection so the first triage isn't slowed by connect().
  getMongoClient().catch((err) => console.warn('[Server] Mongo warm-up skipped:', err.message))
})
