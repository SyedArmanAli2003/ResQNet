require('dotenv').config();
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env.local'), override: true });

let dbInstance;

async function initInsForge() {
  const sdk = await import('@insforge/sdk');
  const supabaseUrl = process.env.INSFORGE_URL || 'https://pk5eng7w.ap-southeast.insforge.app';
  const supabaseKey = process.env.INSFORGE_SERVICE_ROLE_KEY || process.env.INSFORGE_ANON_KEY;

  if (!supabaseKey) {
    console.warn('[InsForge] Warning: Missing INSFORGE_SERVICE_ROLE_KEY or INSFORGE_ANON_KEY in env.');
  }

  dbInstance = sdk.createClient(supabaseUrl, supabaseKey);
  console.log('[InsForge] SDK initialized');
  return dbInstance;
}

function getDb() {
  if (!dbInstance) {
    throw new Error('InsForge not initialized yet! Call initInsForge first.');
  }
  return dbInstance;
}

module.exports = { initInsForge, getDb };
