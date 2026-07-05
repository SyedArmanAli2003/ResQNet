const express = require('express');
const router = express.Router();
const config = require('../config');

const GEMINI_MODELS = [
  { name: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { name: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
];

async function callGemini(prompt) {
  if (!config.geminiApiKey) return null;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
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
        console.warn(`[Dispatch] ${model.label} error (${data.error.code}): ${data.error.message}`);
        if ([429, 403, 404].includes(data.error.code)) continue;
        return null;
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { console.warn(`[Dispatch] ${model.label} returned empty`); continue; }

      const clean = text.replace(/```json|```/g, '').trim();
      const arrStart = clean.indexOf('[');
      const arrEnd = clean.lastIndexOf(']');
      if (arrStart !== -1 && arrEnd !== -1) {
        const result = JSON.parse(clean.substring(arrStart, arrEnd + 1));
        console.log(`[Dispatch] Success with ${model.label}:`, result);
        return result;
      }
    } catch (err) {
      console.warn(`[Dispatch] ${model.label} error:`, err.message);
    }
  }

  console.error('[Dispatch] All Gemini models failed');
  return null;
}

function fallbackDispatch(pendingIncidents, availableVolunteers) {
  const matches = [];
  for (const inc of pendingIncidents) {
    const vol = availableVolunteers.find(v => v.available !== false);
    if (vol) {
      matches.push({ incidentId: inc.id, volunteerId: vol.id });
      vol.available = false;
    }
  }
  return matches;
}

router.post('/', async (req, res) => {
  try {
    const { prompt, pendingIncidents, availableVolunteers } = req.body;

    if (!pendingIncidents || pendingIncidents.length === 0) {
      return res.status(400).json({ error: 'No pending incidents provided' });
    }
    if (!availableVolunteers || availableVolunteers.length === 0) {
      return res.status(400).json({ error: 'No available volunteers provided' });
    }

    let matches = await callGemini(prompt);

    if (!matches || !Array.isArray(matches) || matches.length === 0) {
      console.log('[Dispatch] Gemini failed, using fallback matching');
      matches = fallbackDispatch(pendingIncidents, availableVolunteers);
    }

    res.json({ matches });
  } catch (err) {
    console.error('[Dispatch] POST / error:', err);
    res.status(500).json({ error: 'Dispatch failed' });
  }
});

module.exports = router;
