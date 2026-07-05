const express = require('express');
const router = express.Router();
const { getDb, admin } = require('../middleware/firebase');
const { verifyToken } = require('../middleware/auth');

const incRef = () => getDb().collection('incidents');

router.get('/', async (_req, res) => {
  try {
    const snapshot = await incRef().orderBy('timestamp', 'desc').get();
    const incidents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(incidents);
  } catch (err) {
    console.error('[Incidents] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch incidents' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await incRef().doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Incident not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error('[Incidents] GET /:id error:', err);
    res.status(500).json({ error: 'Failed to fetch incident' });
  }
});

router.post('/', verifyToken, async (req, res) => {
  try {
    const { type, description, location, coordinates, voiceTranscript, reporterName, reporterPhone } = req.body;
    if (!type) return res.status(400).json({ error: 'Incident type is required' });

    const docRef = await incRef().add({
      type,
      description: description || '',
      location: location || 'Unknown location',
      coordinates: coordinates || null,
      voiceTranscript: voiceTranscript || '',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
      triageLevel: null,
      triageComplete: false,
      reportedBy: req.user.uid,
      reporterName: reporterName || req.user.name || 'Anonymous',
      reporterPhone: reporterPhone || ''
    });

    await getDb().collection('incidents').doc(docRef.id).collection('timeline').add({
      action: 'created',
      actor: reporterName || req.user.email || 'reporter',
      details: `${type} incident reported${location !== 'Unknown location' ? ' at ' + location.substring(0, 50) : ''}`,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(201).json({ id: docRef.id, message: 'Incident created' });
  } catch (err) {
    console.error('[Incidents] POST / error:', err);
    res.status(500).json({ error: 'Failed to create incident' });
  }
});

router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;

    if (updates.status === 'resolved') {
      updates.resolvedAt = admin.firestore.FieldValue.serverTimestamp();
      updates.resolvedBy = req.user.email || 'coordinator';

      const incident = await incRef().doc(req.params.id).get();
      const data = incident.data();
      if (data?.assignedVolunteerId) {
        await getDb().collection('volunteers').doc(data.assignedVolunteerId).update({
          available: true,
          activeIncidentId: null
        });
      }
    }

    await incRef().doc(req.params.id).update(updates);

    res.json({ message: 'Incident updated' });
  } catch (err) {
    console.error('[Incidents] PATCH /:id error:', err);
    res.status(500).json({ error: 'Failed to update incident' });
  }
});

router.get('/:id/timeline', async (req, res) => {
  try {
    const snapshot = await getDb().collection('incidents').doc(req.params.id).collection('timeline')
      .orderBy('timestamp', 'asc').get();
    const entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(entries);
  } catch (err) {
    console.error('[Incidents] GET /:id/timeline error:', err);
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

module.exports = router;
