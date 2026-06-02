'use strict'

function getModels() {
  const key = process.env.GEMINI_API_KEY || ''
  return [
    {
      label: 'Gemini 2.5 Flash',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    },
    {
      label: 'Gemini 1.5 Flash',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
    },
  ]
}

function fallbackTriage(type, description = '', voice = '') {
  const text = `${description} ${voice}`.toLowerCase()
  const critical = ['bleeding', 'unconscious', 'heart', 'stroke', 'trapped', 'collapse', 'fire', 'explosion']
  const urgent = ['injured', 'flood', 'riot', 'violence', 'shortage', 'urgent']
  if (critical.some((h) => text.includes(h)))
    return { level: 1, levelName: 'Critical', color: 'red', reasoning: 'High-risk keywords detected.', volunteerTypes: ['medical', 'rapid-response'], estimatedMinutes: 8, modelUsed: 'Fallback rules' }
  if (type === 'Medical' || type === 'Disaster' || urgent.some((h) => text.includes(h)))
    return { level: 2, levelName: 'Severe', color: 'orange', reasoning: 'Urgent incident type.', volunteerTypes: ['rapid-response'], estimatedMinutes: 15, modelUsed: 'Fallback rules' }
  if (type === 'Conflict')
    return { level: 3, levelName: 'Moderate', color: 'yellow', reasoning: 'Conflict report.', volunteerTypes: ['coordination'], estimatedMinutes: 25, modelUsed: 'Fallback rules' }
  if (type === 'Resource')
    return { level: 4, levelName: 'Minor', color: 'green', reasoning: 'Resource need.', volunteerTypes: ['logistics'], estimatedMinutes: 35, modelUsed: 'Fallback rules' }
  if (type === 'Hospitality')
    return { level: 5, levelName: 'Monitoring', color: 'gray', reasoning: 'Support / hospitality.', volunteerTypes: ['community-support'], estimatedMinutes: 45, modelUsed: 'Fallback rules' }
  return { level: 3, levelName: 'Moderate', color: 'yellow', reasoning: 'Default moderate priority.', volunteerTypes: ['support'], estimatedMinutes: 25, modelUsed: 'Fallback rules' }
}

async function callGemini(incident) {
  const prompt = `You are an emergency triage AI.
Analyze this crisis and return ONLY valid JSON. No explanation, no markdown, no backticks.

Type: ${incident.type}
Description: ${incident.description || 'none'}
Voice: ${incident.voiceTranscript || 'none'}
Location: ${incident.location}
${incident.historicalContext ? '\n' + incident.historicalContext + '\n' : ''}
Return exactly:
{"level":1,"levelName":"Critical","color":"red","reasoning":"one sentence","volunteerTypes":["type1"],"estimatedMinutes":10}

Level guide: 1=Critical(red) 2=Severe(orange) 3=Moderate(yellow) 4=Minor(green) 5=Monitoring(gray)`

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
  })

  for (const model of getModels()) {
    try {
      console.log(`[Gemini] Trying ${model.label}...`)
      const res = await fetch(model.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      const data = await res.json()
      if (data.error) {
        console.warn(`[Gemini] ${model.label} error ${data.error.code}: ${data.error.message}`)
        if ([429, 403, 404].includes(data.error.code)) continue
        return null
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) { console.warn(`[Gemini] ${model.label} empty`); continue }
      const raw = text.replace(/```json|```/g, '').trim()
      const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
      if (s === -1 || e === -1) { console.warn(`[Gemini] ${model.label} no JSON`); continue }
      const result = JSON.parse(raw.substring(s, e + 1))
      result.modelUsed = model.label
      // Token usage for observability (Arize). Best-effort — absent on some responses.
      const usage = data.usageMetadata || {}
      result.promptTokens = usage.promptTokenCount || 0
      result.completionTokens = usage.candidatesTokenCount || 0
      console.log(`[Gemini] Success: ${model.label}`)
      return result
    } catch (err) {
      console.warn(`[Gemini] ${model.label}:`, err.message)
    }
  }
  console.error('[Gemini] All models failed')
  return null
}

module.exports = { callGemini, fallbackTriage }
