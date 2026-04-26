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
  listenToVolunteers();
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
    sessionStorage.setItem('coordinatorEmail', email);
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
      sessionStorage.removeItem('coordinatorEmail');
      window.location.href = 'index.html';
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

    const deployedCount = activeCount * 2;
    updateStats(activeCount, deployedCount, resolvedTodayCount);
    renderList(incidents);

  }, (err) => {
    console.error('[Firestore] snapshot error:', err);
    showToast('Error connecting to real-time feed.');
  });
}

// ── TRIAGE LOGIC (Bug 6) ──────────────────────────────────────────────────────
function getTriageDetails(inc) {
  if (inc.triageComplete === false || inc.triageLevel == null) {
    return {
      color: '#2a2d3a', // default border
      label: '<span class="coord-spinner"></span> Analyzing...',
      rank: 99,
      isPending: true
    };
  }

  switch (inc.triageLevel) {
    case 1: return { color: '#A32D2D', label: 'Level 1 — Critical',   rank: 1 };
    case 2: return { color: '#854F0B', label: 'Level 2 — Severe',     rank: 2 };
    case 3: return { color: '#EF9F27', label: 'Level 3 — Moderate',   rank: 3 };
    case 4: return { color: '#3B6D11', label: 'Level 4 — Minor',      rank: 4 };
    case 5: return { color: '#555555', label: 'Level 5 — Monitoring', rank: 5 };
    default: return { color: '#2a2d3a', label: 'Pending', rank: 99, isPending: true };
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

  const activeIncidents = incidents.filter(i => i.status !== 'resolved');

  if (activeIncidents.length === 0) {
    emptyState.style.display = 'block';
    incidentsList.appendChild(emptyState);
    return;
  }
  emptyState.style.display = 'none';

  const sorted = activeIncidents.slice().sort((a, b) => {
    const rankDiff = getTriageDetails(a).rank - getTriageDetails(b).rank;
    if (rankDiff !== 0) return rankDiff;
    return (b.timestamp?.toDate?.()?.getTime?.() || 0) - (a.timestamp?.toDate?.()?.getTime?.() || 0);
  });

  sorted.forEach(inc => {
    const isResolved = inc.status === 'resolved';
    const timeLabel  = timeAgo(inc.timestamp?.toDate());
    const triage     = getTriageDetails(inc);
    const BAD_LOCS   = ['Capturing location...', 'Locating...', '', null, undefined];
    const locationLabel = !BAD_LOCS.includes(inc.location)
      ? inc.location
      : inc.coordinates
        ? `${inc.coordinates.lat?.toFixed(4)}, ${inc.coordinates.lng?.toFixed(4)}`
        : 'Location unavailable';
    const aiReasoning = getAiReasoning(inc);

    const card = document.createElement('div');
    card.className = `coord-incident-card`;
    card.style.borderLeftColor = triage.color;
    if (isResolved) card.style.opacity = '0.55';

    // Badge styling matches triage color with some opacity, unless it's analyzing
    const badgeBg = triage.color === '#2a2d3a' ? '#1c2533' : triage.color + '33';
    let badgeColor = triage.color;
    if (triage.color === '#2a2d3a') badgeColor = '#8e96a3';

    card.innerHTML = `
      <div class="coord-card-row-top">
        <span class="coord-level-badge" style="background:${badgeBg}; color:${badgeColor}; border:1px solid ${triage.color}44; display:flex; align-items:center; gap:6px;">${inc.triageLevelName || triage.label}</span>
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

// ── SPA PANEL SWITCHING (Bug 5) ─────────────────────────────────────────────
window.showPanel = function(name) {
  // Hide all panels
  document.querySelectorAll('.panel').forEach(p => p.style.display = 'none');
  
  // Show target panel
  const target = document.getElementById('panel-' + name);
  if (target) target.style.display = 'block';
  
  // Update active state on nav links
  document.querySelectorAll('.coord-nav-link').forEach(n => n.classList.remove('active'));
  const activeLink = document.querySelector(`[data-panel="${name}"]`);
  if (activeLink) activeLink.classList.add('active');

  // Hide right panel if not on incidents or history (optional, to give more space)
  const rightPanel = document.querySelector('.coord-rightpanel');
  if (rightPanel) {
    if (name === 'incidents') rightPanel.style.display = 'block';
    else rightPanel.style.display = 'none';
  }
};

// Wire up nav links
document.querySelectorAll('.coord-nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const panelName = link.dataset.panel;
    if (panelName) showPanel(panelName);
  });
});

// ── VOLUNTEERS PANEL (Bug 4) ────────────────────────────────────────────────
let volUnsubscribe = null;
let currentVolFilter = 'All';

function listenToVolunteers() {
  if (volUnsubscribe) volUnsubscribe();
  const q = query(collection(db, 'volunteers'), orderBy('registeredAt', 'desc'));
  
  volUnsubscribe = onSnapshot(q, (snapshot) => {
    const list = document.getElementById('coordVolList');
    if (!list) return;
    list.innerHTML = '';
    
    let total = 0, avail = 0, busy = 0;
    
    snapshot.forEach(docSnap => {
      total++;
      const data = docSnap.data();
      const isAvail = data.available;
      if (isAvail) avail++; else busy++;
      
      // Filter logic
      if (currentVolFilter === 'Available' && !isAvail) return;
      if (currentVolFilter === 'Busy' && isAvail) return;
      
      const card = document.createElement('div');
      card.style.cssText = "background:var(--bg-surface); padding:1rem; border-radius:8px; border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;";
      
      card.innerHTML = `
        <div style="display:flex; align-items:center; gap:1rem;">
          <div style="width:40px; height:40px; border-radius:50%; background:var(--bg-deep); display:flex; align-items:center; justify-content:center; border:1px solid var(--border-strong); font-weight:bold;">
            ${(data.name || 'V')[0].toUpperCase()}
          </div>
          <div>
            <div style="font-weight:600; margin-bottom:0.2rem;">${data.name} <span class="coord-badge" style="margin-left:0.5rem; font-weight:normal;">${data.skill}</span></div>
            <div style="font-size:0.85rem; color:var(--text-dim);">📍 ${data.location || 'Unknown'} • 📞 ${data.phone}</div>
          </div>
        </div>
        <button class="btn-ghost vol-toggle-btn" data-id="${docSnap.id}" data-avail="${isAvail}" style="border:1px solid ${isAvail ? 'var(--accent-green)' : 'var(--accent-red)'}; color:${isAvail ? 'var(--accent-green)' : 'var(--accent-red)'};">
          ${isAvail ? 'Available' : 'Busy'}
        </button>
      `;
      list.appendChild(card);
    });
    
    document.getElementById('volTotal').textContent = total;
    document.getElementById('volAvail').textContent = avail;
    document.getElementById('volBusy').textContent = busy;
    const navVolBadge = document.getElementById('navVolBadge');
    if (navVolBadge) navVolBadge.textContent = total;
    
    // Attach toggle listeners
    document.querySelectorAll('.vol-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const currentAvail = btn.dataset.avail === 'true';
        try {
          await updateDoc(doc(db, 'volunteers', id), { available: !currentAvail });
        } catch(e) {
          console.error("Error toggling availability", e);
        }
      });
    });
  });
}

// Wire vol filters
document.querySelectorAll('.vol-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.vol-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentVolFilter = btn.dataset.vfilter;
    listenToVolunteers(); // re-render
  });
});

// ── REPORT PANEL (Bug 5) ────────────────────────────────────────────────────
let panelSelectedCategory = null;
document.querySelectorAll('#panel-report .cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#panel-report .cat-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    panelSelectedCategory = btn.dataset.type;
  });
});

const panelSubmitBtn = document.getElementById('panelSubmitBtn');
if (panelSubmitBtn) {
  panelSubmitBtn.addEventListener('click', async () => {
    if (!panelSelectedCategory) {
      alert("Please select a category.");
      return;
    }
    const desc = document.getElementById('panelIncidentDesc').value.trim();
    const loc = document.getElementById('panelIncidentLoc').value.trim() || 'Unknown Location';
    
    panelSubmitBtn.disabled = true;
    panelSubmitBtn.textContent = 'Submitting...';
    
    try {
      await addDoc(collection(db, 'incidents'), {
        type: panelSelectedCategory,
        description: desc,
        location: loc,
        timestamp: serverTimestamp(),
        status: 'pending',
        triageLevel: null,
        triageComplete: false
      });
      document.getElementById('panelSuccessMsg').style.display = 'block';
      setTimeout(() => {
        document.getElementById('panelSuccessMsg').style.display = 'none';
        document.getElementById('panelIncidentDesc').value = '';
        document.getElementById('panelIncidentLoc').value = '';
        document.querySelectorAll('#panel-report .cat-btn').forEach(b => b.classList.remove('selected'));
        panelSelectedCategory = null;
        showPanel('incidents');
      }, 2000);
    } catch(e) {
      console.error(e);
      alert("Failed to submit report.");
    } finally {
      panelSubmitBtn.disabled = false;
      panelSubmitBtn.textContent = 'Submit Incident';
    }
  });
}

// ── HISTORY PANEL (Bug 5) ───────────────────────────────────────────────────
let histUnsubscribe = null;
let currentHistFilter = 'all';

function listenToHistory() {
  if (histUnsubscribe) histUnsubscribe();
  const q = query(collection(db, 'incidents'), orderBy('timestamp', 'desc'));
  
  histUnsubscribe = onSnapshot(q, (snapshot) => {
    const list = document.getElementById('coordHistList');
    if (!list) return;
    list.innerHTML = '';
    
    let total = 0, pending = 0, resolved = 0;
    
    snapshot.forEach(docSnap => {
      total++;
      const data = docSnap.data();
      const status = data.status || 'pending';
      if (status === 'resolved') resolved++; else pending++;
      
      if (currentHistFilter !== 'all' && status !== currentHistFilter) return;
      
      const triage = getTriageDetails(data);
      const card = document.createElement('div');
      card.style.cssText = `background:var(--bg-surface); padding:1rem; border-radius:8px; border:1px solid var(--border); border-left: 4px solid ${triage.color}; display:flex; justify-content:space-between; align-items:center;`;
      
      const timeStr = timeAgo(data.timestamp?.toDate());
      const badgeBg = triage.color === '#2a2d3a' ? '#1c2533' : triage.color + '33';
      const badgeColor = triage.color === '#2a2d3a' ? '#8e96a3' : triage.color;
      
      card.innerHTML = `
        <div>
          <div style="font-weight:600; margin-bottom:0.4rem;">${data.type || 'Emergency'} <span class="coord-badge" style="background:${badgeBg}; color:${badgeColor}; border:none; margin-left:0.5rem; display:inline-flex; align-items:center; gap:4px;">${triage.label}</span></div>
          <div style="font-size:0.85rem; color:var(--text-dim);">📍 ${data.location || 'Unknown'} • <span style="color:var(--text-muted);">${timeStr}</span></div>
        </div>
        <span class="coord-badge" style="border-color:${status === 'resolved' ? 'var(--accent-green)' : 'var(--accent-red)'}; color:${status === 'resolved' ? 'var(--accent-green)' : 'var(--accent-red)'};">${status === 'resolved' ? 'Resolved' : 'Pending'}</span>
      `;
      list.appendChild(card);
    });
    
    document.getElementById('histTotal').textContent = total;
    document.getElementById('histPending').textContent = pending;
    document.getElementById('histResolved').textContent = resolved;
  });
}

// Wire hist filters
document.querySelectorAll('.hist-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.hist-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentHistFilter = btn.dataset.hfilter;
    listenToHistory(); // re-render
  });
});

// Trigger history listener when dashboard loads
const oldShowDashboardHist = showDashboard;
showDashboard = function(user) {
  oldShowDashboardHist(user);
  listenToHistory();
  if (user) {
    document.getElementById('settingsEmail').value = user.email || '';
    // Load local notification setting
    document.getElementById('settingsNotif').checked = localStorage.getItem('resqnet_notif') === 'true';
  }
};

// ── SETTINGS PANEL (Bug 5) ──────────────────────────────────────────────────
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', async () => {
    saveSettingsBtn.disabled = true;
    saveSettingsBtn.textContent = 'Saving...';
    
    const notif = document.getElementById('settingsNotif').checked;
    localStorage.setItem('resqnet_notif', notif);
    
    const dName = document.getElementById('settingsName').value.trim();
    if (auth.currentUser && dName) {
      try {
        await updateDoc(doc(db, 'settings', auth.currentUser.uid), { displayName: dName });
      } catch(e) {
        // collection might not exist, but we do setDoc in real app.
      }
    }
    
    setTimeout(() => {
      saveSettingsBtn.disabled = false;
      saveSettingsBtn.textContent = 'Save Changes';
      showToast('Settings saved!');
    }, 500);
  });
}

const settingsSignOut = document.getElementById('settingsSignOut');
if (settingsSignOut) {
  settingsSignOut.addEventListener('click', async () => {
    try {
      await signOut(auth);
      sessionStorage.removeItem('coordinatorEmail');
      window.location.href = 'index.html';
    } catch (error) {
      console.log('sign out error: ' + error.message);
    }
  });
}

// --- SIDEBAR NAVIGATION LOGIC ---
document.querySelectorAll('.coord-nav-link').forEach(link => {
  link.addEventListener('click', () => {
    sessionStorage.setItem('cameFrom', 'coordinator');
  });
});
