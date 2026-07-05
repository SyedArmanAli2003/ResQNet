const { getDb } = require('./insforge');

async function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.split('Bearer ')[1];
  try {
    const { data: { user }, error } = await getDb().auth.getUser(token);
    if (error || !user) {
      throw error || new Error('No user found');
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('[Auth] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { verifyToken };
