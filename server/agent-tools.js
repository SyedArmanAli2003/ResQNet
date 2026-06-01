import { getDb, getMongoClient } from './mongodb.js'

/**
 * The three tools the ResQNet Crisis Triage Agent can call.
 * Tool names match the `tools` array in agent-config.json.
 */

/**
 * search_incidents — find similar resolved past incidents for context.
 * Matches on type + a loose location regex, newest first.
 */
async function search_incidents({ location, type }) {
  await getMongoClient()
  const results = await getDb()
    .collection('incidents')
    .find({
      type,
      location: { $regex: escapeRegex(location || ''), $options: 'i' },
      status: 'resolved'
    })
    .sort({ timestamp: -1 })
    .limit(5)
    .toArray()

  return results.map((r) => ({
    type: r.type,
    location: r.location,
    triageLevel: r.triageLevel,
    resolutionTime: r.estimatedMinutes
  }))
}

/**
 * get_volunteers — query available volunteers whose skill matches any of
 * the requested skill types. Falls back to any available volunteer when
 * no skill matches, so the agent always has someone to suggest.
 */
async function get_volunteers({ skillTypes = [], limit = 5 }) {
  await getMongoClient()
  const col = getDb().collection('volunteers')

  const skillFilters = (skillTypes || [])
    .filter(Boolean)
    .map((s) => ({ skill: { $regex: escapeRegex(s), $options: 'i' } }))

  const query = { available: true }
  if (skillFilters.length) query.$or = skillFilters

  let matches = await col.find(query).limit(limit).toArray()

  if (matches.length === 0 && skillFilters.length) {
    // No skill match — return whatever responders are available.
    matches = await col.find({ available: true }).limit(limit).toArray()
  }

  return matches
}

/**
 * log_to_arize — best-effort trace export to Arize / Phoenix for
 * observability. Never throws: a failed export must not fail triage.
 */
async function log_to_arize({ incidentId, modelUsed, triageLevel, reasoning, latencyMs }) {
  const traceUrl = process.env.ARIZE_TRACE_URL
  const apiKey = process.env.ARIZE_API_KEY

  const trace = {
    span_id: incidentId,
    name: 'crisis_triage',
    model: modelUsed,
    input: { incidentId },
    output: { triageLevel, reasoning },
    latency_ms: latencyMs,
    tags: { level: triageLevel }
  }

  if (!traceUrl || !apiKey || apiKey === 'your-arize-key') {
    console.log('[Arize] Export disabled (no key/url) — trace:', incidentId, 'level', triageLevel)
    return { success: false, skipped: true }
  }

  try {
    const res = await fetch(traceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', api_key: apiKey },
      body: JSON.stringify(trace)
    })
    console.log('[Arize] Trace logged:', incidentId, '→', res.status)
    return { success: res.ok, status: res.status }
  } catch (err) {
    console.warn('[Arize] Export failed (non-fatal):', err.message)
    return { success: false, error: err.message }
  }
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export { search_incidents, get_volunteers, log_to_arize }
