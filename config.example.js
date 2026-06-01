// Copy this file, rename it to config.js,
// and fill in your real values.
//
// NOTE: config.js is served to the browser. Only put values here that are
// safe to expose publicly. Backend secrets (MongoDB URI, Arize API key) live
// in server/.env instead — see server/.env.example.
const CONFIG = {
  GEMINI_API_KEY: 'your-gemini-api-key-here',

  // Base URL of the ResQNet agent backend (see /server folder).
  // Leave empty to skip the backend and use the client-side fallback triage.
  BACKEND_URL: 'http://localhost:8787'
}
