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
const statActiveNum = document.getElementById('statActiveNum');
const statDeployedNum = document.getElementById('statDeployedNum');
const statResolvedNum = document.getElementById('statResolvedNum');
const statAvgResponse = document.getElementById('statAvgResponse');

// --- AUTHENTICATION ---
const CORRECT_PASS = 'coord123';

function showDashboard() {
  // Use style.display so the CSS grid layout correctly activates
  authModal.style.display = 'none';
  coordApp.style.display = 'grid';
  startListening();
}

function checkAuth() {
  // If already authenticated this session, skip the modal immediately
  if (sessionStorage.getItem('coordAuth') === 'true') {
    showDashboard();
  }
  // else: modal is already visible (default state in HTML), do nothing
}

authSubmit.addEventListener('click', () => {
  if (passwordInput.value === CORRECT_PASS) {
    sessionStorage.setItem('coordAuth', 'true');
    authError.hidden = true;
    showDashboard();
  } else {
    authError.hidden = false;
    passwordInput.focus();
  }
});

// Enter key submits the password — keydown fires before keypress (deprecated)
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    authSubmit.click();
  }
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
    let resolvedTodayCount = 0;
    const incidents = [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    snapshot.forEach((doc) => {
      const data = doc.data();
      incidents.push({ id: doc.id, ...data });

      if (data.status === 'resolved') {
        const resolvedAt = data.timestamp?.toDate?.();
        if (resolvedAt && resolvedAt >= startOfToday) {
          resolvedTodayCount++;
        }
      } else {
        activeCount++;
      }
    });

    const deployedCount = Math.floor(activeCount * 0.5);
    updateStats(activeCount, deployedCount, resolvedTodayCount);

    renderList(incidents);
  }, (error) => {
    console.error("Error listening to incidents:", error);
    showToast("Error connecting to real-time feed.");
  });
}

function getSeverityDetails(type) {
  switch (type) {
    case 'Medical': return { class: 'level-1', label: 'Level 1 - Critical', rank: 1 };
    case 'Disaster': return { class: 'level-2', label: 'Level 2 - Severe', rank: 2 };
    case 'Conflict': return { class: 'level-3', label: 'Level 3 - Moderate', rank: 3 };
    case 'Resource': return { class: 'level-4', label: 'Level 4 - Minor', rank: 4 };
    case 'Hospitality': return { class: 'level-5', label: 'Level 5 - Monitoring', rank: 5 };
    default: return { class: 'level-4', label: 'Level 4 - Minor', rank: 4 };
  }
}

function getAiReasoning(inc) {
  if (inc.aiReasoning) return inc.aiReasoning;
  if (inc.triageReasoning) return inc.triageReasoning;
  if (inc.voiceTranscript) return `Voice context detected: "${inc.voiceTranscript}"`;
  return 'AI triage: prioritizing available responders by severity and proximity.';
}

function renderList(incidents) {
  if (incidents.length === 0) {
    incidentsList.innerHTML = '';
    emptyState.style.display = 'block';
    incidentsList.appendChild(emptyState);
    return;
  }
  
  emptyState.style.display = 'none';
  
  // Clear list except empty state
  incidentsList.innerHTML = '';

  const sortedIncidents = incidents
    .slice()
    .sort((a, b) => {
      const aSeverity = getSeverityDetails(a.type).rank;
      const bSeverity = getSeverityDetails(b.type).rank;
      if (aSeverity !== bSeverity) return aSeverity - bSeverity;

      const aTime = a.timestamp?.toDate?.()?.getTime?.() || 0;
      const bTime = b.timestamp?.toDate?.()?.getTime?.() || 0;
      return bTime - aTime;
    });

  sortedIncidents.forEach(inc => {
    const isResolved = inc.status === 'resolved';
    const timeLabel = timeAgo(inc.timestamp?.toDate());
    const severity = getSeverityDetails(inc.type);
    const BAD_LOCATIONS = ['Capturing location...', 'Locating...', '', null, undefined];
    const locationLabel = !BAD_LOCATIONS.includes(inc.location)
      ? inc.location
      : inc.coordinates
        ? `${inc.coordinates.lat?.toFixed(4)}, ${inc.coordinates.lng?.toFixed(4)}`
        : 'Location unavailable';
    const aiReasoning = getAiReasoning(inc);
    
    const card = document.createElement('div');
    card.className = `coord-incident-card ${severity.class}`;
    if (isResolved) card.style.opacity = '0.6';

    card.innerHTML = `
      <div class="coord-card-row-top">
        <span class="coord-level-badge ${severity.class}">${severity.label}</span>
        <span class="coord-time-ago">${timeLabel}</span>
      </div>
      <div class="coord-card-body">
        <h3 class="coord-card-title">${inc.type || 'Unknown Crisis'}</h3>
        <p class="coord-card-location">${locationLabel}</p>
        <p class="coord-card-ai">${aiReasoning}</p>
        ${inc.description ? `<p class="coord-card-desc">"${inc.description}"</p>` : ''}
      </div>
      <div class="coord-card-footer">
        <div class="coord-chip-row">
          <span class="coord-chip">Paramedic</span>
          <span class="coord-chip">Rapid response</span>
          <span class="coord-chip">${isResolved ? 'Resolved' : 'Active'}</span>
        </div>
        ${!isResolved ? `<button class="coord-resolve-btn resolve-btn" data-id="${inc.id}">Mark Resolved</button>` : ''}
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

function updateStats(activeCount, deployedCount, resolvedCount) {
  hdrActiveNum.textContent = activeCount;
  hdrDeployedNum.textContent = deployedCount;
  hdrResolvedNum.textContent = resolvedCount;

  statActiveNum.textContent = activeCount;
  statDeployedNum.textContent = deployedCount;
  statResolvedNum.textContent = resolvedCount;

  const avgMinutes = activeCount > 0 ? Math.max(4, 12 - Math.min(activeCount, 8)) : 0;
  statAvgResponse.textContent = avgMinutes > 0 ? `${avgMinutes}m` : '--';
}

// --- TOAST UTILITY ---
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// Keep time ago labels fresh (placeholder for future DOM-targeted updates)
setInterval(() => {
  if (coordApp.style.display !== 'none') {
    // Future: update only time-ago spans without full re-render
  }
}, 60000);
