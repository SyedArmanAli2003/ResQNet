const express = require('express');
const router = express.Router();
const { getDb, admin } = require('../middleware/firebase');

const volRef = () => getDb().collection('volunteers');

router.get('/', async (_req, res) => {
  try {
    const snapshot = await volRef().orderBy('registeredAt', 'desc').get();
    const volunteers = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(volunteers);
  } catch (err) {
    console.error('[Volunteers] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch volunteers' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, phone, skill, location, coordinates, available, uid } = req.body;
    if (!name || !phone || !skill) {
      return res.status(400).json({ error: 'Name, phone, and skill are required' });
    }

    const docRef = await volRef().add({
      name,
      phone,
      skill,
      location: location || 'Location not provided',
      coordinates: coordinates || null,
      available: available !== false,
      uid: uid || null,
      registeredAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(201).json({ id: docRef.id, message: 'Volunteer registered' });
  } catch (err) {
    console.error('[Volunteers] POST / error:', err);
    res.status(500).json({ error: 'Failed to register volunteer' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    await volRef().doc(req.params.id).update(updates);
    res.json({ message: 'Volunteer updated' });
  } catch (err) {
    console.error('[Volunteers] PATCH /:id error:', err);
    res.status(500).json({ error: 'Failed to update volunteer' });
  }
});

module.exports = router;
