const express = require('express');
const router = express.Router();
const { getDb, admin } = require('../middleware/firebase');

const resRef = () => getDb().collection('resources');

router.get('/', async (_req, res) => {
  try {
    const snapshot = await resRef().orderBy('timestamp', 'desc').get();
    const resources = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(resources);
  } catch (err) {
    console.error('[Resources] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch resources' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, type, contact, address } = req.body;
    if (!name || !type || !contact) {
      return res.status(400).json({ error: 'Name, type, and contact are required' });
    }

    const docRef = await resRef().add({
      name,
      type,
      contact,
      address: address || '',
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(201).json({ id: docRef.id, message: 'Resource added' });
  } catch (err) {
    console.error('[Resources] POST / error:', err);
    res.status(500).json({ error: 'Failed to add resource' });
  }
});

module.exports = router;
