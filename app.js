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
let currentAddress = "Capturing location...";
let selectedCategory = null;
let voiceTranscript = "";

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
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    return data.display_name || "Location found";
  } catch (e) {
    return `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
  }
}

// --- VOICE RECORDING (5 SECONDS) ---
function startVoiceCapture() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.log("Speech Recognition not supported.");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = false;

  voiceBanner.hidden = false;
  voiceStatusText.textContent = "🎙 Listening for 5s... speak now";
  voiceTranscript = "";

  recognition.onresult = (event) => {
    voiceTranscript = event.results[0][0].transcript;
    voiceStatusText.textContent = `🎙 "${voiceTranscript}"`;
  };

  recognition.onerror = () => {
    voiceStatusText.textContent = "🎙 Recording failed.";
  };

  recognition.start();

  // Stop after 5 seconds
  setTimeout(() => {
    recognition.stop();
    setTimeout(() => { voiceBanner.hidden = true; }, 2000);
  }, 5000);
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
  
  try {
    const pos = await getPosition();
    currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    currentAddress = await reverseGeocode(currentCoords.lat, currentCoords.lng);
    gpsStatus.textContent = `📍 ${currentAddress}`;
    
    // Start voice recording after GPS
    startVoiceCapture();
  } catch (err) {
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
    showToast("Please select a category");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending...";

  try {
    await addDoc(collection(db, "incidents"), {
      type: selectedCategory,
      description: incidentDesc.value,
      location: currentAddress,
      coordinates: currentCoords,
      voiceTranscript: voiceTranscript,
      timestamp: serverTimestamp(),
      status: "pending",
      triageLevel: null
    });
    
    showToast("Report Sent!");
    categoryModal.hidden = true;
    resetModal();
  } catch (e) {
    showToast("Failed to report.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Send SOS Report";
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
