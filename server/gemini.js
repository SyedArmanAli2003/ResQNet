/**
 * Server-side Gemini triage — ported from reporter.html so the agent can
 * run the model with the same prompt/fallback behaviour, but with the API
 * key kept on the server.
 */

function geminiModels() {
  const key = process.env.GEMINI_API_KEY || ''
  return [
    {
      name: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`
    },
    {
      name: 'gemini-1.5-flash',
      label: 'Gemini 1.5 Flash',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`
    }
  ]
}

function fallbackTriage(type, description = '', voice = '') {
  const text = `${description} ${voice}`.toLowerCase()
  const criticalHints = ['bleeding', 'unconscious', 'heart', 'stroke', 'trapped', 'collapse', 'fire', 'explosion']
  const urgentHints = ['injured', 'flood', 'riot', 'violence', 'shortage', 'urgent']

  if (criticalHints.some((h) => text.includes(h))) {
    return { level: 1, levelName: 'Critical', color: 'red', reasoning: 'Fallback triage detected high-risk keywords.', volunteerTypes: ['medical', 'rapid-response'], estimatedMinutes: 8, modelUsed: 'Fallback rules' }
  }
  if (type === 'Medical' || type === 'Disaster' || urgentHints.some((h) => text.includes(h))) {
    return { level: 2, levelName: 'Severe', color: 'orange', reasoning: 'Fallback triage marked incident as urgent.', volunteerTypes: ['rapid-response'], estimatedMinutes: 15, modelUsed: 'Fallback rules' }
  }
  if (type === 'Conflict') {
    return { level: 3, levelName: 'Moderate', color: 'yellow', reasoning: 'Fallback: conflict report, moderate priority.', volunteerTypes: ['coordination'], estimatedMinutes: 25, modelUsed: 'Fallback rules' }
  }
  if (type === 'Resource') {
    return { level: 4, levelName: 'Minor', color: 'green', reasoning: 'Fallback: resource need.', volunteerTypes: ['logistics'], estimatedMinutes: 35, modelUsed: 'Fallback rules' }
  }
  if (type === 'Hospitality') {
    return { level: 5, levelName: 'Monitoring', color: 'gray', reasoning: 'Fallback: monitoring / support.', volunteerTypes: ['community-support'], estimatedMinutes: 45, modelUsed: 'Fallback rules' }
  }
  return { level: 3, levelName: 'Moderate', color: 'yellow', reasoning: 'Fallback: moderate priority.', volunteerTypes: ['support'], estimatedMinutes: 25, modelUsed: 'Fallback rules' }
}

async function callGeminiWithFallback(incidentData) {
  const prompt = `You are an emergency triage AI.
Analyze this crisis and return ONLY valid JSON.
No explanation, no markdown, no backticks.

Type: ${incidentData.type}
Description: ${incidentData.description || 'none'}
Voice: ${incidentData.voiceTranscript || 'none'}
Location: ${incidentData.location}
${incidentData.historicalContext ? `\n${incidentData.historicalContext}\n` : ''}
Return exactly this shape:
{"level": 1, "levelName": "Critical", "color": "red", "reasoning": "one sentence max", "volunteerTypes": ["type1"], "estimatedMinutes": 10}

Level guide:
1 = Critical (red)
2 = Severe (orange)
3 = Moderate (yellow)
4 = Minor (green)
5 = Monitoring (gray)`

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
  })

  for (const model of geminiModels()) {
    try {
      console.log(`[Gemini] Trying ${model.label}...`)
      const response = await fetch(model.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      const data = await response.json()
      if (data.error) {
        console.warn(`[Gemini] ${model.label} error (${data.error.code}): ${data.error.message}`)
        if ([429, 403, 404].includes(data.error.code) || data.error.message?.includes('billing') || data.error.message?.includes('quota')) continue
        return null
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) { console.warn(`[Gemini] ${model.label} returned empty`); continue }
      const cleanRaw = text.replace(/```json|```/g, '').trim()
      const jsonStart = cleanRaw.indexOf('{')
      const jsonEnd = cleanRaw.lastIndexOf('}')
      if (jsonStart === -1 || jsonEnd === -1) { console.warn(`[Gemini] ${model.label} no JSON found`); continue }
      const result = JSON.parse(cleanRaw.substring(jsonStart, jsonEnd + 1))
      result.modelUsed = model.label
      console.log(`[Gemini] Success with ${model.label}:`, result)
      return result
    } catch (err) {
      console.warn(`[Gemini] ${model.label} error:`, err.message)
      continue
    }
  }
  console.error('[Gemini] All models failed')
  return null
}

export { callGeminiWithFallback, fallbackTriage }
