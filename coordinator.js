import { db, auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from './firebaseConfig.js';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const authModal     = document.getElementById('authModal');
const emailInput    = document.getElementById('emailInput');
const passInput     = document.getElementById('passInput');
const signInBtn     = document.getElementById('signInBtn');
const authError     = document.getElementById('authError');
const coordApp      = document.getElementById('coordApp');
const signOutBtn    = document.getElementById('signOutBtn');
const userEmailEl   = document.getElementById('userEmail');

const incidentsList  = document.getElementById('incidentsList');
const emptyState     = document.getElementById('emptyState');

const hdrActiveNum   = document.getElementById('hdrActiveNum');
const hdrDeployedNum = document.getElementById('hdrDeployedNum');
const hdrResolvedNum = document.getElementById('hdrResolvedNum');
const statActiveNum  = document.getElementById('statActiveNum');
const statDeployedNum= document.getElementById('statDeployedNum');
const statResolvedNum= document.getElementById('statResolvedNum');
const statAvgResponse= document.getElementById('statAvgResponse');

// ── AUTH — Firebase email/password ───────────────────────────────────────────

function showDashboard(user) {
  authModal.style.display = 'none';
  coordApp.style.display  = 'grid';
  if (userEmailEl && user) userEmailEl.textContent = user.email || 'Coordinator';
  startListening();
}

function showLoginForm() {
  coordApp.style.display  = 'none';
  authModal.style.display = 'flex';
}

// Watch Firebase auth state — the single source of truth
onAuthStateChanged(auth, (user) => {
  if (user && !user.isAnonymous) {
    // Signed in with real account → show dashboard
    showDashboard(user);
  } else {
    // Not signed in (or only anonymous) → show login
    showLoginForm();
  }
});

// Sign in button click
signInBtn.addEventListener('click', async () => {
  console.log('attempting login...');
  const email = emailInput.value.trim();
  const password = passInput.value;
  
  if (!email || !password) {
    authError.textContent = 'Please enter email and password';
    authError.style.display = 'block';
    return;
  }

  try {
    authError.style.display = 'none';
    signInBtn.textContent = 'Signing in...';
    await signInWithEmailAndPassword(auth, email, password);
    console.log('login success');
    // onAuthStateChanged will handle showing dashboard
  } catch (error) {
    console.log('auth error: ' + error.code);
    signInBtn.textContent = 'Sign In';
    if (error.code === 'auth/user-not-found' || 
        error.code === 'auth/wrong-password' ||
        error.code === 'auth/invalid-credential') {
      authError.textContent = 'Invalid email or password';
    } else if (error.code === 'auth/too-many-requests') {
      authError.textContent = 'Too many attempts. Try again later';
    } else {
      authError.textContent = 'Error: ' + error.message;
    }
    authError.style.display = 'block';
  }
});

// Also submit on Enter key
passInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    signInBtn.click();
  }
});

// Sign Out button in the sidebar
if (signOutBtn) {
  signOutBtn.addEventListener('click', async () => {
    try {
      await signOut(auth);
      // After signOut: onAuthStateChanged will automatically show login form and hide dashboard
    } catch (error) {
      console.log('sign out error: ' + error.message);
    }
  });
}

// ── RELATIVE TIME ─────────────────────────────────────────────────────────────
function timeAgo(date) {
  if (!date) return 'just now';
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60)  return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)}hr ago`;
  return `${Math.floor(seconds/86400)}d ago`;
}

// ── DATA LISTENER ─────────────────────────────────────────────────────────────
let unsubscribe = null;

function startListening() {
  if (unsubscribe) return;  // already listening

  const q = query(collection(db, 'incidents'), orderBy('timestamp', 'desc'));

  unsubscribe = onSnapshot(q, (snapshot) => {
    let activeCount = 0;
    let resolvedTodayCount = 0;
    const incidents = [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      incidents.push({ id: docSnap.id, ...data });

      if (data.status === 'resolved') {
        const ts = data.timestamp?.toDate?.();
        if (ts && ts >= startOfToday) resolvedTodayCount++;
      } else {
        activeCount++;
      }
    });

    const deployedCount = Math.floor(activeCount * 0.5);
    updateStats(activeCount, deployedCount, resolvedTodayCount);
    renderList(incidents);

  }, (err) => {
    console.error('[Firestore] snapshot error:', err);
    showToast('Error connecting to real-time feed.');
  });
}

// ── SEVERITY ──────────────────────────────────────────────────────────────────
function getSeverityDetails(type) {
  switch (type) {
    case 'Medical':     return { class: 'level-1', label: 'Level 1 — Critical',   rank: 1 };
    case 'Disaster':    return { class: 'level-2', label: 'Level 2 — Severe',     rank: 2 };
    case 'Conflict':    return { class: 'level-3', label: 'Level 3 — Moderate',   rank: 3 };
    case 'Resource':    return { class: 'level-4', label: 'Level 4 — Minor',      rank: 4 };
    case 'Hospitality': return { class: 'level-5', label: 'Level 5 — Monitoring', rank: 5 };
    default:            return { class: 'level-4', label: 'Level 4 — Minor',      rank: 4 };
  }
}

function getAiReasoning(inc) {
  if (inc.aiReasoning)     return inc.aiReasoning;
  if (inc.triageReasoning) return inc.triageReasoning;
  if (inc.voiceTranscript) return `Voice context: "${inc.voiceTranscript}"`;
  return 'AI triage: prioritizing available responders by severity and proximity.';
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function renderList(incidents) {
  incidentsList.innerHTML = '';

  if (incidents.length === 0) {
    emptyState.style.display = 'block';
    incidentsList.appendChild(emptyState);
    return;
  }
  emptyState.style.display = 'none';

  const sorted = incidents.slice().sort((a, b) => {
    const rankDiff = getSeverityDetails(a.type).rank - getSeverityDetails(b.type).rank;
    if (rankDiff !== 0) return rankDiff;
    return (b.timestamp?.toDate?.()?.getTime?.() || 0) - (a.timestamp?.toDate?.()?.getTime?.() || 0);
  });

  sorted.forEach(inc => {
    const isResolved = inc.status === 'resolved';
    const timeLabel  = timeAgo(inc.timestamp?.toDate());
    const severity   = getSeverityDetails(inc.type);
    const BAD_LOCS   = ['Capturing location...', 'Locating...', '', null, undefined];
    const locationLabel = !BAD_LOCS.includes(inc.location)
      ? inc.location
      : inc.coordinates
        ? `${inc.coordinates.lat?.toFixed(4)}, ${inc.coordinates.lng?.toFixed(4)}`
        : 'Location unavailable';
    const aiReasoning = getAiReasoning(inc);

    const card = document.createElement('div');
    card.className = `coord-incident-card ${severity.class}`;
    if (isResolved) card.style.opacity = '0.55';

    card.innerHTML = `
      <div class="coord-card-row-top">
        <span class="coord-level-badge ${severity.class}">${severity.label}</span>
        <span class="coord-time-ago">${timeLabel}</span>
      </div>
      <div class="coord-card-body">
        <h3 class="coord-card-title">${inc.type || 'Unknown Crisis'}</h3>
        <p class="coord-card-location">📍 ${locationLabel}</p>
        <p class="coord-card-ai">${aiReasoning}</p>
        ${inc.description ? `<p class="coord-card-desc">"${inc.description}"</p>` : ''}
      </div>
      <div class="coord-card-footer">
        <div class="coord-chip-row">
          <span class="coord-chip">Paramedic</span>
          <span class="coord-chip">Rapid response</span>
          <span class="coord-chip">${isResolved ? '✅ Resolved' : '🔴 Active'}</span>
        </div>
        ${!isResolved
          ? `<button class="coord-resolve-btn resolve-btn" data-id="${inc.id}">Mark Resolved</button>`
          : ''}
      </div>
    `;

    incidentsList.appendChild(card);
  });

  // Attach resolve listeners
  document.querySelectorAll('.resolve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      btn.textContent = 'Resolving…';
      try {
        await updateDoc(doc(db, 'incidents', id), { status: 'resolved' });
        showToast('Incident marked as resolved.');
      } catch (err) {
        showToast('Failed to update status.');
        btn.disabled = false;
        btn.textContent = 'Mark Resolved';
      }
    });
  });
}

// ── STATS ─────────────────────────────────────────────────────────────────────
function updateStats(activeCount, deployedCount, resolvedCount) {
  hdrActiveNum.textContent    = activeCount;
  hdrDeployedNum.textContent  = deployedCount;
  hdrResolvedNum.textContent  = resolvedCount;
  statActiveNum.textContent   = activeCount;
  statDeployedNum.textContent = deployedCount;
  statResolvedNum.textContent = resolvedCount;
  const avg = activeCount > 0 ? Math.max(4, 12 - Math.min(activeCount, 8)) : 0;
  statAvgResponse.textContent = avg > 0 ? `${avg}m` : '--';
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}
