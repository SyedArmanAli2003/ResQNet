'use strict'

const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { syncIncident, searchIncidents, findVolunteers, saveAgentDecision, getAnalytics } = require('./mongodb')
const { callGemini, fallbackTriage } = require('./gemini')
const { logTriageToArize } = require('./arize')

// ── Secret declarations (stored in Google Cloud Secret Manager) ─────────────
// Set once with: firebase functions:secrets:set GEMINI_API_KEY  (etc.)
// For local emulator dev: create functions/.env with the same keys.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY')
const MONGODB_URI = defineSecret('MONGODB_URI')
const ARIZE_API_KEY = defineSecret('ARIZE_API_KEY')

const REGION = 'us-central1'
const ALL_SECRETS = [GEMINI_API_KEY, MONGODB_URI, ARIZE_API_KEY]

// ── CORS helper ──────────────────────────────────────────────────────────────
// With Firebase Hosting rewrites, CORS is a non-issue in production.
// These headers cover direct function URL calls (emulator / testing).
function setCors(res) {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
}

// ── POST /api/triageIncident ─────────────────────────────────────────────────
// Runs the full multi-step agent pipeline and returns the triage result.
// The browser persists the result to Firestore under the reporter's auth.
exports.triageIncident = onRequest(
  { region: REGION, secrets: ALL_SECRETS },
  async (req, res) => {
    setCors(res)
    if (req.method === 'OPTIONS') return res.status(204).send('')
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

    const { incidentId, type } = req.body || {}
    if (!incidentId || !type) return res.status(400).json({ error: 'incidentId and type are required' })

    const startTime = Date.now()
    console.log('[Agent] Starting triage for', incidentId)

    // Step 0 — mirror incident to MongoDB (best-effort; don't abort on failure)
    try {
      await syncIncident({
        id: incidentId,
        type: req.body.type,
        description: req.body.description,
        location: req.body.location,
        coordinates: req.body.coordinates,
        voiceTranscript: req.body.voiceTranscript,
        status: req.body.status || 'pending',
        timestamp: req.body.timestamp ? new Date(req.body.timestamp) : new Date(),
      })
    } catch (err) {
      console.warn('[Agent] sync skipped:', err.message)
    }

    // Step 1 — search for similar past incidents
    let similar = []
    try {
      similar = await searchIncidents({ location: req.body.location, type })
    } catch (err) {
      console.warn('[Agent] history search skipped:', err.message)
    }
    console.log('[Agent] Similar incidents:', similar.length)

    // Step 2 — build context-aware prompt
    const historicalContext =
      similar.length > 0
        ? `Historical data: ${similar.length} similar incidents in this area. Average triage level: ${Math.round(
            similar.reduce((s, i) => s + (i.triageLevel || 3), 0) / similar.length
          )}.`
        : 'No historical incidents found in this area.'

    // Step 3 — run Gemini (falls back to keyword rules if all models fail)
    const triage =
      (await callGemini({ ...req.body, historicalContext })) ||
      fallbackTriage(type, req.body.description, req.body.voiceTranscript)

    // Step 4 — match volunteers from MongoDB
    let volunteers = []
    try {
      volunteers = await findVolunteers({ skillTypes: triage.volunteerTypes })
    } catch (err) {
      console.warn('[Agent] volunteer match skipped:', err.message)
    }
    console.log('[Agent] Matched volunteers:', volunteers.length)

    const latencyMs = Date.now() - startTime
    const suggestedVolunteers = volunteers.slice(0, 3).map((v) => ({ name: v.name, skill: v.skill }))

    // Step 5 — export OpenTelemetry trace to Arize Phoenix (best-effort)
    await logTriageToArize({
      incidentId,
      incidentType: type,
      location: req.body.location,
      triageLevel: triage.level,
      reasoning: triage.reasoning,
      modelUsed: triage.modelUsed,
      latencyMs,
      promptTokens: triage.promptTokens || 0,
      completionTokens: triage.completionTokens || 0,
    })

    // Step 6 — persist decision to MongoDB (best-effort)
    try {
      await saveAgentDecision({
        incidentId,
        steps: ['synced_incident', 'searched_history', 'ran_gemini', 'matched_volunteers', 'logged_arize'],
        result: triage,
        similarIncidentsFound: similar.length,
        suggestedVolunteers,
        latencyMs,
        timestamp: new Date(),
      })
    } catch (err) {
      console.warn('[Agent] decision log skipped:', err.message)
    }

    console.log('[Agent] Done in', latencyMs, 'ms')
    return res.json({
      triage,
      similarIncidentsFound: similar.length,
      suggestedVolunteers,
      agentSteps: 5,
      agentLatencyMs: latencyMs,
      promptTokens: triage.promptTokens || 0,
      completionTokens: triage.completionTokens || 0,
    })
  }
)

// ── GET /api/volunteers?skill=Medical ────────────────────────────────────────
// Returns available MongoDB volunteers filtered by skill. Used by the
// coordinator dashboard and by the agent's volunteer-matching step.
exports.getVolunteers = onRequest(
  { region: REGION, secrets: [MONGODB_URI] },
  async (req, res) => {
    setCors(res)
    if (req.method === 'OPTIONS') return res.status(204).send('')
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

    const skill = req.query.skill || ''
    const limit = Math.min(parseInt(req.query.limit || '10', 10), 50)

    try {
      const results = await findVolunteers({
        skillTypes: skill ? [skill] : [],
        limit,
      })
      return res.json({ volunteers: results })
    } catch (err) {
      console.error('[getVolunteers] failed:', err.message)
      return res.status(500).json({ error: err.message })
    }
  }
)

// ── POST /api/syncIncident ───────────────────────────────────────────────────
// Mirrors a Firestore incident into MongoDB so the agent's history search
// can find it on subsequent triage calls.
exports.syncIncident = onRequest(
  { region: REGION, secrets: [MONGODB_URI] },
  async (req, res) => {
    setCors(res)
    if (req.method === 'OPTIONS') return res.status(204).send('')
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

    const { id } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id is required' })

    try {
      await syncIncident(req.body)
      return res.json({ success: true })
    } catch (err) {
      console.error('[syncIncident] failed:', err.message)
      return res.status(500).json({ error: err.message })
    }
  }
)

// ── GET /api/analytics ───────────────────────────────────────────────────────
// All-time MongoDB aggregation for the coordinator Insights panel. Powers the
// "MongoDB Analytics" section (total incidents, top crisis type, top area).
exports.analytics = onRequest(
  { region: REGION, secrets: [MONGODB_URI] },
  async (req, res) => {
    setCors(res)
    if (req.method === 'OPTIONS') return res.status(204).send('')
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

    try {
      const data = await getAnalytics()
      return res.json(data)
    } catch (err) {
      console.error('[analytics] failed:', err.message)
      return res.status(500).json({ error: err.message })
    }
  }
)
