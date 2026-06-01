import { search_incidents, get_volunteers, log_to_arize } from './agent-tools.js'
import { callGeminiWithFallback, fallbackTriage } from './gemini.js'
import { getDb, getMongoClient, syncIncidentToMongo } from './mongodb.js'

/**
 * runTriageAgent — the multi-step agentic triage.
 *
 * Steps: search history → build context → run Gemini → match volunteers →
 * log to Arize → persist the decision to MongoDB. Returns the full result
 * to the caller (the browser persists triage fields to Firestore under the
 * reporter's auth). Throws on hard failure so the API can fall back.
 */
async function runTriageAgent(incident) {
  const startTime = Date.now()
  console.log('[Agent] Starting multi-step triage for', incident.incidentId)

  // Step 0 — mirror the incoming incident into MongoDB so future searches
  // can find it (best-effort; should not abort triage).
  try {
    await syncIncidentToMongo({
      id: incident.incidentId,
      type: incident.type,
      description: incident.description,
      location: incident.location,
      coordinates: incident.coordinates,
      voiceTranscript: incident.voiceTranscript,
      status: incident.status || 'pending',
      timestamp: incident.timestamp ? new Date(incident.timestamp) : new Date()
    })
  } catch (err) {
    console.warn('[Agent] Incident sync skipped:', err.message)
  }

  // Step 1 — search for similar resolved incidents.
  console.log('[Agent] Step 1: Searching history...')
  let similarIncidents = []
  try {
    similarIncidents = await search_incidents({ location: incident.location, type: incident.type })
  } catch (err) {
    console.warn('[Agent] search_incidents failed:', err.message)
  }
  console.log('[Agent] Found similar:', similarIncidents.length)

  // Step 2 — build context-aware prompt.
  const historicalContext =
    similarIncidents.length > 0
      ? `Historical data: ${similarIncidents.length} similar incidents in this area. Average triage level: ${Math.round(
          similarIncidents.reduce((sum, i) => sum + (i.triageLevel || 3), 0) / similarIncidents.length
        )}`
      : 'No historical incidents found in this area.'

  // Step 3 — run Gemini with full context (fallback rules if all models fail).
  console.log('[Agent] Step 2: Running Gemini...')
  const triage =
    (await callGeminiWithFallback({ ...incident, historicalContext })) ||
    fallbackTriage(incident.type, incident.description, incident.voiceTranscript)

  // Step 4 — find matching volunteers.
  console.log('[Agent] Step 3: Finding volunteers...')
  let volunteers = []
  try {
    volunteers = await get_volunteers({ skillTypes: triage.volunteerTypes })
  } catch (err) {
    console.warn('[Agent] get_volunteers failed:', err.message)
  }
  console.log('[Agent] Found volunteers:', volunteers.length)

  const latencyMs = Date.now() - startTime
  const suggestedVolunteers = volunteers.slice(0, 3).map((v) => ({ name: v.name, skill: v.skill }))

  // Step 5 — log to Arize (best-effort).
  console.log('[Agent] Step 4: Logging to Arize...')
  await log_to_arize({
    incidentId: incident.incidentId,
    modelUsed: triage.modelUsed,
    triageLevel: triage.level,
    reasoning: triage.reasoning,
    latencyMs
  })

  // Step 6 — persist the agent decision to MongoDB (best-effort).
  try {
    await getMongoClient()
    await getDb()
      .collection('agent_decisions')
      .insertOne({
        incidentId: incident.incidentId,
        steps: ['searched_history', 'ran_gemini', 'found_volunteers', 'logged_to_arize', 'persisted_decision'],
        result: triage,
        similarIncidentsFound: similarIncidents.length,
        suggestedVolunteers,
        latencyMs,
        timestamp: new Date()
      })
  } catch (err) {
    console.warn('[Agent] agent_decisions write skipped:', err.message)
  }

  console.log('[Agent] All steps complete in', latencyMs, 'ms')

  return {
    triage,
    similarIncidentsFound: similarIncidents.length,
    suggestedVolunteers,
    agentSteps: 5,
    agentLatencyMs: latencyMs
  }
}

export { runTriageAgent }
