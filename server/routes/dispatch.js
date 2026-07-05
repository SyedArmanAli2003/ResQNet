const express = require('express');
const router = express.Router();
const { callAI } = require('./aiCascade');

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
    const { prompt, pendingIncidents, availableVolunteers, preferredModel } = req.body;

    if (!pendingIncidents || pendingIncidents.length === 0)
      return res.status(400).json({ error: 'No pending incidents provided' });
    if (!availableVolunteers || availableVolunteers.length === 0)
      return res.status(400).json({ error: 'No available volunteers provided' });

    const ai = await callAI(
      [{ role: 'user', content: prompt }],
      { preferredModel: preferredModel || 'nim-deepseek', parseJson: true, arrayMode: true }
    );

    let matches = Array.isArray(ai?.result) && ai.result.length > 0
      ? ai.result
      : fallbackDispatch(pendingIncidents, availableVolunteers);

    res.json({ matches, modelUsed: ai?.modelUsed || 'Fallback rules' });
  } catch (err) {
    console.error('[Dispatch] POST / error:', err);
    res.status(500).json({ error: 'Dispatch failed' });
  }
});

module.exports = router;
