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
const sosBtn = document.getElementById('sosBtn');
const sosProgress = document.getElementById('sosProgressCircle');
const categoryModal = document.getElementById('categoryModal');
const gpsStatus = document.getElementById('gpsStatus');
const voiceBanner = document.getElementById('voiceBanner');
const voiceStatusText = document.getElementById('voiceStatusText');
const submitError = document.getElementById('submitError');
const catBtns = document.querySelectorAll('.cat-btn');
const incidentDesc = document.getElementById('incidentDesc');
const submitBtn = document.getElementById('submitIncident');
const cancelBtn = document.getElementById('cancelModal');
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

// --- VOICE CAPTURE (Issue 4: getUserMedia first, then SpeechRecognition + countdown) ---
async function startVoiceCapture() {
  voiceTranscript = '';
  voiceBanner.hidden = false;
  voiceStatusText.textContent = '\uD83C\uDF99 Requesting mic permission...';
  console.log('[Voice] Step 1: Requesting mic permission via getUserMedia');

  // Step 1 — Force the mic permission popup
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[Voice] mic permission granted');
  } catch (err) {
    console.log('[Voice] mic permission denied or unavailable:', err.message);
    voiceStatusText.textContent = 'Voice capture unavailable \u2014 tap Send to continue without it';
    setTimeout(() => { voiceBanner.hidden = true; }, 4000);
    return;
  }

  // Step 2 — Check SpeechRecognition support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.log('[Voice] SpeechRecognition not supported in this browser');
    voiceStatusText.textContent = 'Voice capture unavailable \u2014 tap Send to continue without it';
    stream.getTracks().forEach(t => t.stop());
    setTimeout(() => { voiceBanner.hidden = true; }, 4000);
    return;
  }

  // Step 3 — Start recognition
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    voiceTranscript = event.results[0][0].transcript;
    console.log('[Voice] transcript received:', voiceTranscript);
    voiceStatusText.textContent = `\uD83C\uDF99 Heard: "${voiceTranscript}"`;
  };

  recognition.onerror = (event) => {
    console.log('[Voice] recognition error:', event.error);
    voiceStatusText.textContent = 'Voice capture unavailable \u2014 tap Send to continue without it';
  };

  recognition.onend = () => {
    console.log('[Voice] recognition ended');
    stream.getTracks().forEach(t => t.stop()); // release mic
    // Keep banner visible 2s after end so user sees result
    setTimeout(() => { voiceBanner.hidden = true; }, 2000);
  };

  try {
    recognition.start();
    console.log('[Voice] recognition started');
  } catch (err) {
    console.log('[Voice] failed to start recognition:', err.message);
    voiceStatusText.textContent = 'Voice capture unavailable \u2014 tap Send to continue without it';
    stream.getTracks().forEach(t => t.stop());
    setTimeout(() => { voiceBanner.hidden = true; }, 3000);
    return;
  }

  // Step 4 — 5-second visual countdown
  let seconds = 5;
  voiceStatusText.textContent = `\uD83C\uDF99 Speak now... ${seconds}`;
  const countdown = setInterval(() => {
    seconds--;
    if (seconds > 0) {
      voiceStatusText.textContent = `\uD83C\uDF99 Speak now... ${seconds}`;
    } else {
      clearInterval(countdown);
      voiceStatusText.textContent = voiceTranscript
        ? `\uD83C\uDF99 Heard: "${voiceTranscript}"`
        : '\uD83C\uDF99 No speech detected';
      try { recognition.stop(); } catch (_) {}
    }
  }, 1000);
}

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
  categoryModal.hidden = false;
  gpsStatus.textContent = "📍 Capturing GPS...";
  currentCoords = null;
  currentAddress = null;

  try {
    const pos = await getPosition();
    currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    // Show raw coords immediately so user sees something while geocoding runs
    const rawCoords = formatCoords(currentCoords.lat, currentCoords.lng);
    gpsStatus.textContent = `📍 ${rawCoords}`;
    currentAddress = rawCoords;

    // Reverse-geocode with built-in 5-second timeout
    const resolved = await reverseGeocode(currentCoords.lat, currentCoords.lng);
    currentAddress = resolved;
    gpsStatus.textContent = `📍 ${resolved}`;

    // Start voice recording after GPS is confirmed
    startVoiceCapture();
  } catch (err) {
    currentCoords = null;
    currentAddress = "Location unavailable";
    gpsStatus.textContent = "📍 GPS permission denied.";
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

cancelBtn.addEventListener('click', () => {
  categoryModal.hidden = true;
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

    await addDoc(collection(db, 'incidents'), {
      type: selectedCategory,
      description: incidentDesc.value,
      location: safeLocation,
      coordinates: currentCoords,
      voiceTranscript: voiceTranscript,
      timestamp: serverTimestamp(),
      status: 'pending',
      triageLevel: null
    });

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

// --- REAL-TIME FEED ---
function listenToIncidents() {
  const q = query(collection(db, "incidents"), orderBy("timestamp", "desc"));
  
  onSnapshot(q, (snapshot) => {
    incidentsList.innerHTML = "";
    let active = 0;
    let resolved = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.status === 'resolved') {
        resolved++;
      } else {
        active++;
        renderIncidentCard({ id: doc.id, ...data });
      }
    });

    activeCountEl.textContent = active;
    resolvedCountEl.textContent = resolved;
  });
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
