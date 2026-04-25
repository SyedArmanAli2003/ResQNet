// NOTE: Must be served via localhost or HTTPS for mic to work
// Run with: npx serve .
// Then open http://localhost:3000
import { db, ensureAuth } from './firebaseConfig.js';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp, 
  doc, 
  updateDoc 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
async function init() {
  await ensureAuth();
  listenToIncidents();
}
init();

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
  const fallback = formatCoords(lat, lng);

  // Hard 5-second deadline — whichever resolves first wins
  const timeoutPromise = new Promise(resolve =>
    setTimeout(() => resolve(fallback), 5000)
  );

  const fetchPromise = (async () => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=en`
      );
      if (!res.ok) return fallback;
      const data = await res.json();
      return data.display_name || fallback;
    } catch {
      return fallback;
    }
  })();

  return Promise.race([fetchPromise, timeoutPromise]);
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

  try {
    // Guarantee location is always a real string — never a placeholder
    const safeLocation = (currentAddress && currentAddress !== 'Locating...')
      ? currentAddress
      : currentCoords
        ? formatCoords(currentCoords.lat, currentCoords.lng)
        : 'Location unavailable';

    const docRef = await addDoc(collection(db, 'incidents'), {
      type: selectedCategory,
      description: incidentDesc.value,
      location: safeLocation,
      coordinates: currentCoords,
      voiceTranscript: voiceTranscript,
      timestamp: serverTimestamp(),
      status: 'pending',
      triageLevel: null
    });

    // Store in session history
    let myHistory = JSON.parse(sessionStorage.getItem('myIncidents') || '[]');
    myHistory.push(docRef.id);
    sessionStorage.setItem('myIncidents', JSON.stringify(myHistory));

    // Success — redirect to coordinator dashboard
    window.location.href = 'coordinator.html';

  } catch (e) {
    console.error('[Submit] Firestore write failed:', e);
    // Show visible red error on screen — never leave button stuck
    submitError.textContent = '\u26A0\uFE0F Failed to send report. Check your connection and try again.';
    submitError.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send SOS Report';
  }
});

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
