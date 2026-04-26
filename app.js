// NOTE: Must be served via localhost or HTTPS for mic to work
// Run with: npx serve .
// Then open http://localhost:3000
import { db, auth, signOut, onAuthStateChanged } from './firebaseConfig.js';
import { getCurrentUser } from './auth.js';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp, 
  doc, 
  updateDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// API keys loaded from config.js
const GEMINI_API_KEY = CONFIG.GEMINI_API_KEY;

const GEMINI_MODELS = [
  {
    name: 'gemini-3.0-flash',
    label: 'Gemini 3 Flash',
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:generateContent?key=${GEMINI_API_KEY}`
  },
  {
    name: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash (free)',
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`
  }
];

// --- DOM ELEMENTS ---
const sosBtn        = document.getElementById('sosBtn');
const sosProgress   = document.getElementById('sosProgressCircle');
const categoryModal = document.getElementById('categoryModal');
const gpsStatus     = document.getElementById('gpsStatus');
const micBtn        = document.getElementById('micBtn');
const voiceStatus   = document.getElementById('voiceStatus');    // <p> status text
const submitError   = document.getElementById('submitError');
const catBtns       = document.querySelectorAll('.cat-btn');
const incidentDesc  = document.getElementById('incidentDesc');
const submitBtn     = document.getElementById('submitIncident');
const cancelBtn     = document.getElementById('cancelModal');
const successModal  = document.getElementById('successModal');
const btnSubmitAnother = document.getElementById('btnSubmitAnother');
const incidentsList = document.getElementById('incidentsList');
const activeCountEl = document.getElementById('activeCount');
const resolvedCountEl = document.getElementById('resolvedCount');

// --- STATE ---
let holdTimer = null;
let isHolding = false;
let currentCoords = null;
let currentAddress = null;   // null until GPS resolves — never store placeholder strings
let selectedCategory = null;
let voiceTranscript = "";

function formatCoords(lat, lng) {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Initialize
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'auth.html'
    return
  }
  
  // Get full profile from Firestore
  const userDoc = await getDoc(
    doc(db, 'users', user.uid))
  const profile = userDoc.exists() ? 
    userDoc.data() : null

  const name = profile?.fullName || 
    user.displayName || 'User'
  const email = user.email || ''
  const initials = name.split(' ')
    .map(n => n[0]).join('').toUpperCase()
    .slice(0, 2)

  document.getElementById('userName').textContent = name
  document.getElementById('userEmail').textContent = email
  document.getElementById('userAvatar').textContent = 
    initials

  // Store for use in incident submission
  sessionStorage.setItem('userProfile', 
    JSON.stringify({ ...profile, uid: user.uid, email }))

  listenToIncidents();
});

const btnSignOut = document.getElementById('signOutBtn');
if (btnSignOut) {
  btnSignOut.addEventListener('click', async () => {
    await signOut(auth);
    sessionStorage.removeItem('userProfile');
    window.location.href = 'auth.html';
  });
}

// --- GPS & REVERSE GEOCODING ---
async function getPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { 
      enableHighAccuracy: true,
      timeout: 10000 
    });
  });
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en' }
    });
    const data = await res.json();
    return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

// --- GEMINI TRIAGE ---
async function callGeminiWithFallback(incidentData) {
  const prompt = `You are an emergency triage AI.
Analyze this crisis and return ONLY valid JSON.
No explanation, no markdown, no backticks.

Type: ${incidentData.type}
Description: ${incidentData.description || 'none'}
Voice: ${incidentData.voiceTranscript || 'none'}
Location: ${incidentData.location}

Return exactly this shape:
{
  "level": 1,
  "levelName": "Critical",
  "color": "red",
  "reasoning": "one sentence max",
  "volunteerTypes": ["type1", "type2"],
  "estimatedMinutes": 10
}

Level guide:
1 = Critical (red) — life threatening, immediate
2 = Severe (orange) — urgent within 1 hour
3 = Moderate (yellow) — serious but stable
4 = Minor (green) — can wait several hours
5 = Monitoring (gray) — informational only`

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 300
    }
  })

  for (const model of GEMINI_MODELS) {
    try {
      console.log(`[Gemini] Trying ${model.label}...`)

      const response = await fetch(model.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      })

      const data = await response.json()

      // If this model returned a billing/quota error, skip to next model
      if (data.error) {
        const code = data.error.code
        const msg = data.error.message
        console.warn(`[Gemini] ${model.label} failed (${code}): ${msg}`)

        // These error codes mean we should try fallback
        if (
          code === 429 ||   // quota exceeded
          code === 403 ||   // billing required
          code === 404 ||   // model not found
          msg?.includes('billing') ||
          msg?.includes('quota') ||
          msg?.includes('not found') ||
          msg?.includes('deprecated')
        ) {
          console.log(`[Gemini] Falling back to next model...`)
          continue
        }

        // Other errors (bad request etc) — don't retry
        return null
      }

      // Success — parse and return result
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text

      if (!text) {
        console.warn(`[Gemini] ${model.label} returned empty response, trying fallback...`)
        continue
      }

      const clean = text.replace(/```json|```/g, '').trim()
      const result = JSON.parse(clean)

      console.log(`[Gemini] Success with ${model.label}:`, result)

      // Tag which model was used (for debugging)
      result.modelUsed = model.label
      return result

    } catch (err) {
      console.warn(`[Gemini] ${model.label} threw error:`, err.message)
      continue
    }
  }

  // All models failed
  console.error('[Gemini] All models failed')
  return null
}

// --- VOICE CAPTURE (Issue 2: tap-to-record, user-initiated) ---

// Module-level handles so cancel can clean them up
let activeRecognition = null;
let activeStream      = null;

function updateVoiceUI(message) {
  voiceStatus.textContent = message;
}

function setupMicButton() {
  micBtn.addEventListener('click', () => {
    // Prevent double-tap while recording
    if (micBtn.classList.contains('recording')) return;

    // Cannot use mic on file:// protocol
    if (window.location.protocol === 'file:') {
      updateVoiceUI('Open via localhost for mic support');
      voiceTranscript = '';
      return;
    }

    updateVoiceUI('Requesting mic permission...');

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        activeStream = stream;
        console.log('[Voice] mic permission granted');

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
          updateVoiceUI('Speech recognition not supported in this browser — you can still submit');
          stream.getTracks().forEach(t => t.stop());
          activeStream = null;
          return;
        }

        const recognition = new SpeechRecognition();
        activeRecognition = recognition;
        recognition.lang = 'en-US';
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        // Visual countdown 5...4...3...2...1
        let count = 5;
        micBtn.classList.add('recording');
        updateVoiceUI(`Listening... ${count}`);
        const timer = setInterval(() => {
          count--;
          if (count > 0) {
            updateVoiceUI(`Listening... ${count}`);
          } else {
            clearInterval(timer);
          }
        }, 1000);

        recognition.onresult = (event) => {
          voiceTranscript = event.results[0][0].transcript;
          console.log('[Voice] transcript received:', voiceTranscript);
          updateVoiceUI(`Captured: "${voiceTranscript}"`);
        };

        recognition.onerror = (e) => {
          console.log('[Voice] recognition error:', e.error);
          updateVoiceUI(`Mic error: ${e.error} — you can still submit`);
          voiceTranscript = '';
          clearInterval(timer);
          micBtn.classList.remove('recording');
        };

        recognition.onend = () => {
          console.log('[Voice] recognition ended');
          clearInterval(timer);
          micBtn.classList.remove('recording');
          stream.getTracks().forEach(t => t.stop());
          activeStream = null;
          activeRecognition = null;
          if (!voiceTranscript) {
            updateVoiceUI('Nothing captured — tap to try again');
          }
        };

        recognition.start();
        console.log('[Voice] recognition started');
        // Auto-stop after 5 seconds
        setTimeout(() => {
          try { recognition.stop(); } catch (_) {}
        }, 5000);
      })
      .catch(err => {
        console.log('[Voice] getUserMedia error:', err.message);
        updateVoiceUI(`Mic blocked: ${err.message} — you can still submit without voice`);
        voiceTranscript = '';
        activeStream = null;
      });
  });
}

setupMicButton();

// --- SOS HOLD LOGIC ---
sosBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  isHolding = true;
  sosProgress.style.strokeDashoffset = '0';
  sosProgress.style.transition = 'stroke-dashoffset 2s linear';
  
  holdTimer = setTimeout(async () => {
    if (isHolding) {
      triggerSOS();
    }
  }, 2000);
});

const endHold = () => {
  isHolding = false;
  clearTimeout(holdTimer);
  sosProgress.style.transition = 'none';
  sosProgress.style.strokeDashoffset = '339';
};

window.addEventListener('pointerup', endHold);
window.addEventListener('pointercancel', endHold);

async function triggerSOS() {
  categoryModal.style.display = 'flex';  // show modal
  gpsStatus.textContent = '\uD83D\uDCCD Capturing GPS...';
  currentCoords = null;
  currentAddress = null;
  // Reset voice UI for each new SOS session
  voiceTranscript = '';
  updateVoiceUI('');
  micBtn.classList.remove('recording');
  micBtn.querySelector('.mic-label').textContent = 'Tap to record (5 sec)';

  try {
    const pos = await getPosition();
    currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const rawCoords = formatCoords(currentCoords.lat, currentCoords.lng);
    gpsStatus.textContent = `\uD83D\uDCCD ${rawCoords}`;
    currentAddress = rawCoords;

    // Reverse-geocode with built-in 5-second timeout
    const resolved = await reverseGeocode(currentCoords.lat, currentCoords.lng);
    currentAddress = resolved;
    gpsStatus.textContent = `\uD83D\uDCCD ${resolved}`;
  } catch (err) {
    currentCoords = null;
    currentAddress = 'Location unavailable';
    gpsStatus.textContent = '\uD83D\uDCCD GPS permission denied.';
  }
}

// --- MODAL LOGIC ---
catBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    catBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedCategory = btn.dataset.type;
  });
});

// Issue 1 — Cancel: hide modal, abort voice, release mic, reset SOS button
cancelBtn.addEventListener('click', () => {
  // 1. Hide modal
  categoryModal.style.display = 'none';

  // 2. Abort any active SpeechRecognition
  if (activeRecognition) {
    try { activeRecognition.abort(); } catch (_) {}
    activeRecognition = null;
  }

  // 3. Stop any active mic stream
  if (activeStream) {
    activeStream.getTracks().forEach(t => t.stop());
    activeStream = null;
  }

  // 4. Reset SOS button to default state
  sosProgress.style.transition = 'none';
  sosProgress.style.strokeDashoffset = '339';
  isHolding = false;
  clearTimeout(holdTimer);

  // 5. Clear transcript and voice UI
  voiceTranscript = '';
  updateVoiceUI('');
  micBtn.classList.remove('recording');

  resetModal();
});

function resetModal() {
  selectedCategory = null;
  catBtns.forEach(b => b.classList.remove('active'));
  incidentDesc.value = "";
  voiceTranscript = "";
}

submitBtn.addEventListener('click', async () => {
  if (!selectedCategory) {
    showToast('Please select a category');
    return;
  }

  // Clear any previous error
  submitError.style.display = 'none';
  submitError.textContent = '';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending...';

  console.log("[ResQNet] SOS submitted, writing to Firestore...");

  try {
    // Guarantee location is always a real string — never a placeholder
    const safeLocation = (currentAddress && currentAddress !== 'Locating...')
      ? currentAddress
      : currentCoords
        ? formatCoords(currentCoords.lat, currentCoords.lng)
        : 'Unknown location';

    const userProfile = getCurrentUser();

    const docRef = await addDoc(collection(db, 'incidents'), {
      type: selectedCategory,
      description: incidentDesc.value,
      location: safeLocation,
      coordinates: currentCoords,
      voiceTranscript: voiceTranscript,
      timestamp: serverTimestamp(),
      status: 'pending',
      triageLevel: null,
      reportedBy: userProfile ? userProfile.uid : 'unknown',
      reporterName: userProfile ? userProfile.fullName : 'Anonymous user',
      reporterPhone: userProfile ? userProfile.phone : ''
    });

    // Store in session history
    let myHistory = JSON.parse(sessionStorage.getItem('myIncidents') || '[]');
    myHistory.push(docRef.id);
    sessionStorage.setItem('myIncidents', JSON.stringify(myHistory));

    console.log(`[ResQNet] Firestore write success, id: ${docRef.id}`);

    // Trigger Gemini Triage asynchronously (don't block UI)
    callGeminiWithFallback({
      type: selectedCategory,
      description: incidentDesc.value,
      voiceTranscript: voiceTranscript,
      location: safeLocation
    }).then(async (triage) => {
      if (triage) {
        await updateDoc(docRef, {
          triageLevel: triage.level,
          triageLevelName: triage.levelName,
          triageColor: triage.color,
          triageReasoning: triage.reasoning,
          volunteerTypes: triage.volunteerTypes,
          estimatedMinutes: triage.estimatedMinutes,
          triageComplete: true,
          modelUsed: triage.modelUsed || 'unknown'
        });
        console.log('[ResQNet] Triage saved:', triage.levelName, 'via', triage.modelUsed);
      } else {
        await updateDoc(docRef, {
          triageComplete: false,
          triageReasoning: 'AI triage unavailable — all models failed'
        });
      }
    });

    // Success — show modal
    categoryModal.style.display = 'none';
    if (successModal) {
      successModal.style.display = 'flex';
      
      const triageResultEl = document.getElementById('aiTriageResult');
      const badgeEl = document.getElementById('aiTriageBadge');
      const reasonEl = document.getElementById('aiTriageReasoning');
      
      if (triageResultEl) {
        triageResultEl.style.display = 'none'; // hide until complete
        
        const unsub = onSnapshot(docRef, (docSnap) => {
          const data = docSnap.data();
          if (data && data.triageComplete) {
            triageResultEl.style.display = 'block';
            let colorHex = '#2a2d3a';
            let bgHex = '#1c2533';
            let fontColor = '#8e96a3';
            
            switch (data.triageLevel) {
              case 1: colorHex = '#A32D2D'; break;
              case 2: colorHex = '#854F0B'; break;
              case 3: colorHex = '#EF9F27'; break;
              case 4: colorHex = '#3B6D11'; break;
              case 5: colorHex = '#555555'; break;
            }
            
            if (data.triageLevel >= 1 && data.triageLevel <= 5) {
              bgHex = colorHex + '33';
              fontColor = colorHex;
            }
            
            badgeEl.textContent = data.triageLevelName || \`Level \${data.triageLevel}\`;
            badgeEl.style.background = bgHex;
            badgeEl.style.color = fontColor;
            
            reasonEl.textContent = data.triageReasoning || 'AI triage complete.';
            
            unsub(); // stop listening once we got the result
          }
        });
      }
    }

  } catch (e) {
    console.error('[Submit] Firestore write failed:', e);
    // Show visible red error on screen — never leave button stuck
    submitError.textContent = '\u26A0\uFE0F Failed to send report. Check your connection and try again.';
    submitError.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send SOS Report';
  }
});

// Submit another report logic
if (btnSubmitAnother) {
  btnSubmitAnother.addEventListener('click', () => {
    successModal.style.display = 'none';
    
    // Reset form states
    selectedCategory = null;
    voiceTranscript = "";
    incidentDesc.value = "";
    updateVoiceUI("");
    catBtns.forEach(btn => btn.classList.remove('selected'));
    
    // Reset SOS button state
    isHolding = false;
    clearTimeout(holdTimer);
    sosBtn.classList.remove('holding', 'complete');
    sosProgress.style.strokeDashoffset = '314';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send SOS Report';
  });
}

// --- REAL-TIME FEED (reporter page sidebar stats) ---
function listenToIncidents() {
  const q = query(collection(db, 'incidents'), orderBy('timestamp', 'desc'));

  onSnapshot(q, (snapshot) => {
    if (incidentsList) incidentsList.innerHTML = '';
    let active = 0;
    let resolved = 0;

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data.status === 'resolved') {
        resolved++;
      } else {
        active++;
        if (incidentsList) renderIncidentCard({ id: docSnap.id, ...data });
      }
    });

    if (activeCountEl)  activeCountEl.textContent  = active;
    if (resolvedCountEl) resolvedCountEl.textContent = resolved;
    const statActiveEl  = document.getElementById('statActive');
    const statResolvedEl = document.getElementById('statResolved');
    if (statActiveEl)   statActiveEl.textContent  = active;
    if (statResolvedEl) statResolvedEl.textContent = resolved;
  });
}

function getTypeIcon(type) {
  switch(type) {
    case 'Medical': return '🏥';
    case 'Disaster': return '🌊';
    case 'Conflict': return '⚔️';
    case 'Resource': return '📦';
    case 'Hospitality': return '🏠';
    default: return '🆘';
  }
}

function renderIncidentCard(inc) {
  const severity = getSeverity(inc.type);
  const card = document.createElement('div');
  card.className = `incident-card`;
  card.style.borderLeftColor = severity.color;

  const time = inc.timestamp ? inc.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now";

  card.innerHTML = `
    <div class="card-top">
      <span class="card-level" style="color: ${severity.color}">${severity.label}</span>
      <span>${time}</span>
    </div>
    <h3 class="card-title">${inc.type} emergency</h3>
    <p class="card-loc">${inc.location}</p>
    ${inc.description ? `<p class="card-desc">"${inc.description}"</p>` : ''}
    ${inc.voiceTranscript ? `<p class="card-desc" style="color: var(--accent-red)">🎙 "${inc.voiceTranscript}"</p>` : ''}
    <div class="card-tags">
      <span class="tag">Paramedic</span>
      <span class="tag">First aid</span>
    </div>
    <button class="btn-resolve" data-id="${inc.id}">Mark resolved</button>
  `;

  card.querySelector('.btn-resolve').addEventListener('click', async (e) => {
    const id = e.target.dataset.id;
    await updateDoc(doc(db, "incidents", id), { status: "resolved" });
  });

  incidentsList.appendChild(card);
}

function getSeverity(type) {
  switch(type) {
    case 'Medical': return { color: '#E53935', label: 'Level 1 — Critical' };
    case 'Disaster': return { color: '#F57C00', label: 'Level 2 — Severe' };
    case 'Conflict': return { color: '#FBC02D', label: 'Level 3 — Moderate' };
    default: return { color: '#4CAF50', label: 'Level 4 — Minor' };
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// --- SIDEBAR NAVIGATION LOGIC ---
document.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', () => {
    sessionStorage.setItem('cameFrom', 'reporter');
  });
});
