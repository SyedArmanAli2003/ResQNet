'use strict'

const { randomBytes } = require('crypto')

// Arize Phoenix OTLP/HTTP trace ingest endpoint (override with ARIZE_OTLP_URL).
const DEFAULT_OTLP_URL = 'https://otlp.arize.com/v1/traces'

/**
 * Export one crisis-triage span to Arize Phoenix via OTLP/HTTP (JSON).
 *
 * Best-effort: never throws — a failed trace export must not fail triage.
 * The API key is read from process.env.ARIZE_API_KEY (server-side only, never
 * shipped to the browser). Uses OpenInference semantic conventions so the span
 * renders as an LLM call in the Phoenix UI.
 */
async function logTriageToArize({
  incidentId,
  incidentType,
  location,
  triageLevel,
  reasoning,
  modelUsed,
  latencyMs,
  promptTokens = 0,
  completionTokens = 0,
}) {
  const url = process.env.ARIZE_OTLP_URL || DEFAULT_OTLP_URL
  const key = process.env.ARIZE_API_KEY
  const spaceId = process.env.ARIZE_SPACE_ID

  if (!key || key === 'your-arize-key') {
    console.log('[Arize] disabled (no key) — span:', incidentId, 'level', triageLevel)
    return { ok: false, skipped: true }
  }

  const now = Date.now()
  const safeLatency = Number(latencyMs) || 0

  const payload = {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'resqnet-triage' } },
          { key: 'model_id', value: { stringValue: modelUsed || 'unknown' } },
        ],
      },
      scopeSpans: [{
        spans: [{
          // OTLP wants hex trace/span IDs (16 / 8 bytes).
          traceId: randomBytes(16).toString('hex'),
          spanId: randomBytes(8).toString('hex'),
          name: 'crisis_triage',
          kind: 1, // SPAN_KIND_INTERNAL
          startTimeUnixNano: String((now - safeLatency) * 1e6),
          endTimeUnixNano: String(now * 1e6),
          attributes: [
            { key: 'openinference.span.kind', value: { stringValue: 'LLM' } },
            { key: 'input.value', value: { stringValue: `${incidentType} at ${location}` } },
            { key: 'output.value', value: { stringValue: `Level ${triageLevel}: ${reasoning || ''}` } },
            { key: 'llm.model_name', value: { stringValue: modelUsed || 'unknown' } },
            { key: 'llm.token_count.prompt', value: { intValue: promptTokens } },
            { key: 'llm.token_count.completion', value: { intValue: completionTokens } },
            { key: 'triage_level', value: { intValue: triageLevel } },
            { key: 'latency_ms', value: { intValue: safeLatency } },
            { key: 'incident.id', value: { stringValue: String(incidentId) } },
          ],
        }],
      }],
    }],
  }

  const headers = { 'Content-Type': 'application/json', api_key: key }
  if (spaceId) headers.space_id = spaceId

  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
    console.log('[Arize] span exported:', incidentId, '→', r.status)
    return { ok: r.ok, status: r.status }
  } catch (err) {
    console.warn('[Arize] export failed (non-fatal):', err.message)
    return { ok: false, error: err.message }
  }
}

module.exports = { logTriageToArize }
