import { createClient } from '@insforge/sdk'

export const INSFORGE_URL = 'https://pk5eng7w.ap-southeast.insforge.app'
export const INSFORGE_ANON_KEY = 'anon_8cdce68be8188b489d5c12ad3b86adff9054b6599225e0f9dc950f611e7468a8'

export const insforge = createClient({
  baseUrl: INSFORGE_URL,
  anonKey: INSFORGE_ANON_KEY
})

export const db = insforge.database
export const auth = insforge.auth
export const realtime = insforge.realtime
