import { db, ensureAuth } from './firebaseConfig.js';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// DOM Elements
const authModal = document.getElementById('authModal');
const passwordInput = document.getElementById('passwordInput');
const authSubmit = document.getElementById('authSubmit');
const authError = document.getElementById('authError');
const coordApp = document.getElementById('coordApp');

const incidentsList = document.getElementById('incidentsList');
const emptyState = document.getElementById('emptyState');

const hdrActiveNum = document.getElementById('hdrActiveNum');
const hdrDeployedNum = document.getElementById('hdrDeployedNum');
const hdrResolvedNum = document.getElementById('hdrResolvedNum');

// --- AUTHENTICATION (MVP PASSWORD GATE) ---
const CORRECT_PASS = "coord123";

function checkAuth() {
  const isAuthed = sessionStorage.getItem('coordAuthed');
  if (isAuthed === 'true') {
    authModal.hidden = true;
    coordApp.hidden = false;
    startListening();
  } else {
    authModal.hidden = false;
    coordApp.hidden = true;
  }
}

authSubmit.addEventListener('click', () => {
  if (passwordInput.value === CORRECT_PASS) {
    sessionStorage.setItem('coordAuthed', 'true');
    authError.hidden = true;
    authModal.hidden = true;
    coordApp.hidden = false;
    startListening();
  } else {
    authError.hidden = false;
  }
});

passwordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') authSubmit.click();
});

// Initialize
async function init() {
  await ensureAuth();
  checkAuth();
}
init();

// --- RELATIVE TIME FORMATTER ---
function timeAgo(date) {
  if (!date) return 'just now';
  const seconds = Math.floor((new Date() - date) / 1000);
  
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " yr ago";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " mo ago";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " d ago";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " hr ago";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " min ago";
  return Math.floor(seconds) + " s ago";
}

// --- DATA LISTENER & RENDERING ---
let unsubscribe = null;

function startListening() {
  if (unsubscribe) return;

  const q = query(collection(db, "incidents"), orderBy("timestamp", "desc"));
  
  unsubscribe = onSnapshot(q, (snapshot) => {
    let activeCount = 0;
    let resolvedCount = 0;
    const incidents = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      incidents.push({ id: doc.id, ...data });
      if (data.status === 'resolved') resolvedCount++;
      else activeCount++;
    });

    // Update Header Stats
    hdrActiveNum.textContent = activeCount;
    hdrDeployedNum.textContent = Math.floor(activeCount * 0.5); // Dummy stat for mockup
    hdrResolvedNum.textContent = resolvedCount;

    renderList(incidents);
  }, (error) => {
    console.error("Error listening to incidents:", error);
    showToast("Error connecting to real-time feed.");
  });
}

function getSeverityDetails(type) {
  switch (type) {
    case 'Medical': return { class: 'level-1', label: 'Level 1 — Critical' };
    case 'Disaster': return { class: 'level-2', label: 'Level 2 — Severe' };
    case 'Conflict': return { class: 'level-3', label: 'Level 3 — Moderate' };
    case 'Resource': return { class: 'level-4', label: 'Level 4 — Minor' };
    case 'Hospitality': return { class: 'level-5', label: 'Level 5 — Monitoring' };
    default: return { class: 'level-4', label: 'Level 4 — Minor' };
  }
}

function renderList(incidents) {
  if (incidents.length === 0) {
    emptyState.style.display = 'block';
    const oldCards = incidentsList.querySelectorAll('.incident-card');
    oldCards.forEach(c => c.remove());
    return;
  }
  
  emptyState.style.display = 'none';
  
  // Clear list except empty state
  incidentsList.innerHTML = '';
  incidentsList.appendChild(emptyState);

  incidents.forEach(inc => {
    // Only show pending incidents by default in the mockup view (optional choice, but showing all for now with resolved styling)
    const isResolved = inc.status === 'resolved';
    const timeLabel = timeAgo(inc.timestamp?.toDate());
    const severity = getSeverityDetails(inc.type);
    
    const card = document.createElement('div');
    card.className = `incident-card ${severity.class}`;
    if (isResolved) card.style.opacity = '0.6';

    let voiceHtml = '';
    if (inc.voiceTranscript) {
      voiceHtml = `
        <div class="card-voice">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>
          "<span>${inc.voiceTranscript}</span>"
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-header">
        <span class="card-level">${severity.label}</span>
        <span>${timeLabel}</span>
      </div>
      <div>
        <h3 class="card-title">${inc.type || 'Unknown Crisis'}</h3>
        <p class="card-location">${inc.location}</p>
        ${inc.description ? `<p class="card-desc">"${inc.description}"</p>` : ''}
        ${voiceHtml}
      </div>
      <div class="card-footer">
        <div class="card-tags">
          <span class="tag">${isResolved ? 'Resolved' : 'Active'}</span>
        </div>
        ${!isResolved ? `<button class="btn-outline btn-sm resolve-btn" data-id="${inc.id}">Mark resolved</button>` : ''}
      </div>
    `;

    incidentsList.appendChild(card);
  });

  // Attach event listeners to Resolve buttons
  document.querySelectorAll('.resolve-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      btn.disabled = true;
      btn.textContent = 'Resolving...';
      try {
        await updateDoc(doc(db, "incidents", id), {
          status: 'resolved'
        });
        showToast("Incident marked as resolved.");
      } catch (err) {
        showToast("Failed to update status.");
        btn.disabled = false;
        btn.textContent = 'Mark resolved';
      }
    });
  });
}

// --- TOAST UTILITY ---
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// Keep time ago tags fresh
setInterval(() => {
  if (coordApp.hidden === false) {
    // A bit hacky to re-render everything, but works for MVP
    // We would ideally just update the DOM nodes
  }
}, 60000);
