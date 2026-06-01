// Copy this file to public/config.js and fill in your real values.
// config.js is browser-served — only safe-to-expose values go here.
// Backend secrets (MONGODB_URI, ARIZE_API_KEY) belong in functions/.env.
const CONFIG = {
  GEMINI_API_KEY: 'your-gemini-api-key-here',

  // Leave empty in production — Cloud Functions are served via hosting rewrites.
  // For local emulator: 'http://127.0.0.1:5001/resqnet-e74e0/us-central1'
  BACKEND_URL: ''
}
