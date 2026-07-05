import { insforge, db, auth } from './insforge.js'

// Express AI/triage backend — set CONFIG.BACKEND_URL in public/config.js for prod
const BACKEND_URL = (typeof CONFIG !== 'undefined' && CONFIG.BACKEND_URL) ? CONFIG.BACKEND_URL : 'http://localhost:3000'

const sosBtn = document.getElementById('sosBtn')
const sosProgress = document.getElementById('sosProgressCircle')
const categoryModal = document.getElementById('categoryModal')
const gpsStatus = document.getElementById('gpsStatus')
const micBtn = document.getElementById('micBtn')
const voiceStatus = document.getElementById('voiceStatus')
const catBtns = document.querySelectorAll('.cat-btn')
const incidentDesc = document.getElementById('incidentDesc')
const submitBtn = document.getElementById('submitIncident')
const cancelBtn = document.getElementById('cancelModal')
const successModal = document.getElementById('successModal')
const btnSubmitAnother = document.getElementById('btnSubmitAnother')
const incidentsList = document.getElementById('incidentsList')
const activeCountEl = document.getElementById('activeCount')
const resolvedCountEl = document.getElementById('resolvedCount')
const statActiveEl = document.getElementById('statActive')
const statResolvedEl = document.getElementById('statResolved')
const signOutBtn = document.getElementById('signOutBtn')
const avatarEl = document.getElementById('userAvatar')
const nameEl = document.getElementById('userName')
const emailEl = document.getElementById('userEmail')

let currentCoords = null
let currentAddress = null
let selectedCategory = null
let voiceTranscript = ''
let activeRecognition = null
let activeStream = null
let holdTimer = null
let holdActive = false
let pollInterval = null
const VOICE_RECORD_SECONDS = 15

function formatCoords(lat, lng) { return `${lat.toFixed(4)}, ${lng.toFixed(4)}` }

function updateVoiceUI(msg) { if (voiceStatus) voiceStatus.textContent = msg }

function stopActiveVoiceCapture() {
  if (activeRecognition) { try { activeRecognition.abort() } catch { } }
  if (activeStream) { activeStream.getTracks().forEach(t => t.stop()); activeStream = null }
  if (micBtn) micBtn.classList.remove('recording')
}

function setupMicButton() {
  if (!micBtn) return
  micBtn.addEventListener('click', async () => {
    if (micBtn.classList.contains('recording')) return
    if (!navigator.mediaDevices?.getUserMedia) { updateVoiceUI('Microphone API not supported.'); return }
    voiceTranscript = ''
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      activeStream = stream
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SpeechRecognition) { updateVoiceUI('Speech-to-text not supported.'); stopActiveVoiceCapture(); return }
      const recognition = new SpeechRecognition()
      activeRecognition = recognition
      recognition.lang = 'en-US'
      recognition.interimResults = true
      micBtn.classList.add('recording')
      let count = VOICE_RECORD_SECONDS
      updateVoiceUI(`Listening... ${count}`)
      const ci = setInterval(() => { count--; if (count > 0) updateVoiceUI(`Listening... ${count}`); else clearInterval(ci) }, 1000)
      recognition.onresult = (e) => { const t = e.results?.[0]?.[0]?.transcript?.trim(); if (t) { voiceTranscript = t; updateVoiceUI(`Captured: "${t}"`) } }
      recognition.onerror = () => { clearInterval(ci); updateVoiceUI('Mic error') }
      recognition.onend = () => { clearInterval(ci); stopActiveVoiceCapture(); if (!voiceTranscript) updateVoiceUI('Nothing captured') }
      recognition.start()
      setTimeout(() => { try { recognition.stop() } catch { } }, VOICE_RECORD_SECONDS * 1000)
    } catch (err) { updateVoiceUI('Mic blocked: ' + (err.message || 'Permission denied')); stopActiveVoiceCapture() }
  })
}

function setSidebarProfile(name, email, uid, extras = {}) {
  const fn = name || 'User'
  const initials = fn.trim().split(' ').filter(Boolean).map(p => p[0].toUpperCase()).join('').slice(0, 2) || 'U'
  if (avatarEl) avatarEl.textContent = initials
  if (nameEl) nameEl.textContent = fn
  if (emailEl) emailEl.textContent = email || ''
  sessionStorage.setItem('userProfile', JSON.stringify({ uid, fullName: fn, email, ...extras }))
}

async function loadUserProfile(user) {
  const fn = user.displayName || user.email?.split('@')[0] || 'User'
  setSidebarProfile(fn, user.email || '', user.id, {})

  const { data } = await db.from('users').select('*').eq('id', user.id).single()
  if (data) {
    setSidebarProfile(data.full_name || data.name || fn, user.email || data.email || '', user.id, data)
  }
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } })
    const d = await r.json()
    return d.display_name || formatCoords(lat, lng)
  } catch { return formatCoords(lat, lng) }
}

function getPosition() {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 }))
}

function resetHoldState() {
  holdActive = false; clearTimeout(holdTimer); holdTimer = null
  if (sosBtn) { sosBtn.style.transform = 'scale(1)'; sosBtn.style.boxShadow = '0 0 30px rgba(163, 45, 45, 0.3)' }
  if (sosProgress) { sosProgress.style.transition = 'none'; sosProgress.style.strokeDashoffset = '339' }
}

async function triggerSOS() {
  if (!categoryModal) return
  categoryModal.style.display = 'flex'
  gpsStatus.textContent = '📍 Capturing GPS...'
  currentCoords = null; currentAddress = null
  try {
    const pos = await getPosition()
    currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
    gpsStatus.textContent = `📍 ${formatCoords(currentCoords.lat, currentCoords.lng)}`
    currentAddress = await reverseGeocode(currentCoords.lat, currentCoords.lng)
    gpsStatus.textContent = `📍 ${currentAddress}`
  } catch { currentAddress = 'Location unavailable'; gpsStatus.textContent = '📍 GPS denied.' }
}

setupMicButton()

sosBtn?.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  e.preventDefault()
  if (holdActive) return; holdActive = true
  if (sosBtn) { sosBtn.style.transform = 'scale(0.95)'; sosBtn.style.boxShadow = '0 0 0 8px rgba(163,45,45,0.3)' }
  if (sosProgress) { sosProgress.style.strokeDashoffset = '0'; sosProgress.style.transition = 'stroke-dashoffset 2s linear' }
  holdTimer = setTimeout(() => { if (holdActive) { resetHoldState(); triggerSOS() } }, 2000)
})
sosBtn?.addEventListener('pointerup', resetHoldState)
sosBtn?.addEventListener('pointerleave', resetHoldState)
sosBtn?.addEventListener('pointercancel', resetHoldState)
sosBtn?.addEventListener('lostpointercapture', resetHoldState)

catBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    catBtns.forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedCategory = btn.dataset.type
  })
})

cancelBtn?.addEventListener('click', () => {
  if (categoryModal) categoryModal.style.display = 'none'
  selectedCategory = null; currentCoords = null; currentAddress = null; incidentDesc.value = ''
  catBtns.forEach(b => b.classList.remove('active'))
})

submitBtn?.addEventListener('click', async () => {
  if (!selectedCategory) { alert('Please select a category'); return }
  submitBtn.disabled = true; submitBtn.textContent = 'Sending...'
  try {
    const userProfile = JSON.parse(sessionStorage.getItem('userProfile') || 'null')
    const safeLocation = currentAddress || (currentCoords ? formatCoords(currentCoords.lat, currentCoords.lng) : 'Unknown location')
    const session = await auth.getCurrentUser()

    const { data, error } = await db.from('incidents').insert([{
      type: selectedCategory,
      description: incidentDesc.value,
      location: safeLocation,
      coordinates: currentCoords,
      voice_transcript: voiceTranscript,
      status: 'pending',
      triage_complete: false,
      reporter_id: session?.user?.id || null,
      reporter_name: userProfile?.fullName || session?.user?.email || 'Anonymous user',
      reporter_phone: userProfile?.phone || ''
    }]).select()

    if (error) throw error
    const docId = data?.[0]?.id
    if (!docId) throw new Error('No ID returned')

    await db.from('incident_timeline').insert([{
      incident_id: docId,
      action: 'created',
      actor: userProfile?.fullName || session?.user?.email || 'reporter',
      details: `${selectedCategory} incident reported${safeLocation !== 'Unknown location' ? ' at ' + safeLocation.substring(0, 50) : ''}`,
      created_at: new Date().toISOString()
    }])

    if (categoryModal) categoryModal.style.display = 'none'
    if (successModal) successModal.style.display = 'flex'

    try {
      const preferredModel = localStorage.getItem('resqnet_preferred_model') || 'nim-deepseek'
      const triageResponse = await fetch(`${BACKEND_URL}/api/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: selectedCategory, description: incidentDesc.value, voiceTranscript, location: safeLocation, preferredModel })
      })
      const triageResult = triageResponse.ok ? await triageResponse.json() : null

      const updates = {
        triage_level: triageResult?.level || null,
        triage_level_name: triageResult?.levelName || null,
        triage_color: triageResult?.color || null,
        triage_reasoning: triageResult?.reasoning || null,
        volunteer_types: triageResult?.volunteerTypes || [],
        estimated_minutes: triageResult?.estimatedMinutes || null,
        triage_complete: true,
        model_used: triageResult?.modelUsed || 'backend'
      }

      await db.from('incidents').update(updates).eq('id', docId)
      await db.from('incident_timeline').insert([{
        incident_id: docId,
        action: 'triaged',
        actor: triageResult?.modelUsed || 'system',
        details: `Triage → Level ${triageResult?.level || 'N/A'} (${triageResult?.levelName || 'Unknown'}): ${triageResult?.reasoning || ''}`,
        created_at: new Date().toISOString()
      }])
    } catch (triageErr) {
      console.warn('[Triage] Backend call failed:', triageErr.message)
    }
  } catch (err) {
    console.error('[Submit] failed:', err)
    alert('Failed to send report. Please try again.')
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = 'Send SOS Report'
  }
})

btnSubmitAnother?.addEventListener('click', () => {
  if (successModal) successModal.style.display = 'none'
  selectedCategory = null; currentCoords = null; currentAddress = null; incidentDesc.value = ''
  catBtns.forEach(b => b.classList.remove('active'))
})

function pollIncidents() {
  const session = auth.getCurrentUser()
  db.from('incidents').select('*').order('created_at', { ascending: false }).limit(50).then(({ data, error }) => {
    if (error || !data) return
    incidentsList.innerHTML = ''
    let active = 0, resolved = 0
    data.forEach(inc => {
      if (inc.status === 'resolved') { resolved++; return }
      active++
      const sev = { Medical: '#E53935', Disaster: '#F57C00', Conflict: '#FBC02D', Resource: '#4CAF50', Hospitality: '#757575' }
      const color = sev[inc.type] || '#4CAF50'
      const card = document.createElement('div')
      card.className = 'incident-card'
      card.style.borderLeftColor = color
      const timeLabel = inc.created_at ? new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'
      card.innerHTML = `
        <div class="card-top"><span style="color:${color}">${inc.triage_level_name || inc.type}</span><span>${timeLabel}</span></div>
        <h3 class="card-title">${inc.type} emergency</h3>
        <p class="card-loc">${inc.location || 'Location unavailable'}</p>
        ${inc.description ? `<p class="card-desc">"${inc.description}"</p>` : ''}`
      incidentsList.appendChild(card)
    })
    if (activeCountEl) activeCountEl.textContent = active
    if (resolvedCountEl) resolvedCountEl.textContent = resolved
    if (statActiveEl) statActiveEl.textContent = active
    if (statResolvedEl) statResolvedEl.textContent = resolved
  })
}

auth.onAuthStateChange((event, session) => {
  if (!session?.user) { window.location.href = 'auth.html'; return }
  loadUserProfile(session.user)
  pollIncidents()
  pollInterval = setInterval(pollIncidents, 5000)
})

signOutBtn?.addEventListener('click', async () => {
  signOutBtn.disabled = true
  try { await auth.signOut() } catch { }
  finally { sessionStorage.clear(); window.location.href = 'auth.html' }
})
