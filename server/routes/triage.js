const express = require('express');
const router = express.Router();
const config = require('../config');

const GEMINI_MODELS = [
  { name: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { name: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
];

function fallbackTriage(type, description = '', voice = '') {
  const text = `${description} ${voice}`.toLowerCase();
  const criticalHints = ['bleeding', 'unconscious', 'heart', 'stroke', 'trapped', 'collapse', 'fire', 'explosion'];
  const urgentHints = ['injured', 'flood', 'riot', 'violence', 'shortage', 'urgent'];

  if (criticalHints.some(h => text.includes(h))) {
    return { level: 1, levelName: 'Critical', color: 'red', reasoning: 'Fallback triage detected high-risk keywords.',
      volunteerTypes: ['medical', 'rapid-response'], estimatedMinutes: 8, modelUsed: 'Fallback rules' };
  }
  if (type === 'Medical' || type === 'Disaster' || urgentHints.some(h => text.includes(h))) {
    return { level: 2, levelName: 'Severe', color: 'orange', reasoning: 'Fallback triage marked incident as urgent.',
      volunteerTypes: ['rapid-response'], estimatedMinutes: 15, modelUsed: 'Fallback rules' };
  }
  if (type === 'Conflict') {
    return { level: 3, levelName: 'Moderate', color: 'yellow', reasoning: 'Fallback: conflict report, moderate priority.',
      volunteerTypes: ['coordination'], estimatedMinutes: 25, modelUsed: 'Fallback rules' };
  }
  if (type === 'Resource') {
    return { level: 4, levelName: 'Minor', color: 'green', reasoning: 'Fallback: resource need.',
      volunteerTypes: ['logistics'], estimatedMinutes: 35, modelUsed: 'Fallback rules' };
  }
  if (type === 'Hospitality') {
    return { level: 5, levelName: 'Monitoring', color: 'gray', reasoning: 'Fallback: monitoring / support.',
      volunteerTypes: ['community-support'], estimatedMinutes: 45, modelUsed: 'Fallback rules' };
  }
  return { level: 3, levelName: 'Moderate', color: 'yellow', reasoning: 'Fallback: moderate priority.',
    volunteerTypes: ['support'], estimatedMinutes: 25, modelUsed: 'Fallback rules' };
}

async function callGemini(incidentData) {
  if (!config.geminiApiKey) return null;

  const prompt = `You are an emergency triage AI.\nAnalyze this crisis and return ONLY valid JSON.\nNo explanation, no markdown, no backticks.\n\nType: ${incidentData.type}\nDescription: ${incidentData.description || 'none'}\nVoice: ${incidentData.voiceTranscript || 'none'}\nLocation: ${incidentData.location}\n\nReturn exactly this shape:\n{"level": 1, "levelName": "Critical", "color": "red", "reasoning": "one sentence max", "volunteerTypes": ["type1"], "estimatedMinutes": 10}\n\nLevel guide:\n1 = Critical (red)\n2 = Severe (orange)\n3 = Moderate (yellow)\n4 = Minor (green)\n5 = Monitoring (gray)`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
  });

  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.name}:generateContent?key=${config.geminiApiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      const data = await response.json();

      if (data.error) {
        console.warn(`[Triage] ${model.label} error (${data.error.code}): ${data.error.message}`);
        if ([429, 403, 404].includes(data.error.code) || data.error.message?.includes('billing') || data.error.message?.includes('quota')) continue;
        return null;
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { console.warn(`[Triage] ${model.label} returned empty`); continue; }

      const clean = text.replace(/```json|```/g, '').trim();
      const jsonStart = clean.indexOf('{');
      const jsonEnd = clean.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) continue;

      const result = JSON.parse(clean.substring(jsonStart, jsonEnd + 1));
      result.modelUsed = model.label;
      console.log(`[Triage] Success with ${model.label}:`, result);
      return result;
    } catch (err) {
      console.warn(`[Triage] ${model.label} error:`, err.message);
    }
  }

  console.error('[Triage] All Gemini models failed');
  return null;
}

router.post('/', async (req, res) => {
  try {
    const { type, description, voiceTranscript, location } = req.body;
    if (!type) return res.status(400).json({ error: 'Incident type is required' });

    const data = {
      type,
      description: description || '',
      voiceTranscript: voiceTranscript || '',
      location: location || 'Unknown'
    };

    const aiResult = await callGemini(data);
    const triage = aiResult || fallbackTriage(type, description, voiceTranscript);

    console.log(`[Triage] Result: Level ${triage.level} (${triage.levelName}) via ${triage.modelUsed}`);
    res.json(triage);
  } catch (err) {
    console.error('[Triage] POST / error:', err);
    res.status(500).json({ error: 'Triage failed' });
  }
});

module.exports = router;
