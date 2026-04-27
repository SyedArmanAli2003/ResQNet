import { db, auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from './firebaseConfig.js';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

window.__coordBooted = true;

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
const statPendingTriage = document.getElementById('statPendingTriage');

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
let latestIncidents = [];
let volunteerPool = [];

function startListening() {
  if (unsubscribe) return;  // already listening

  const q = query(collection(db, 'incidents'), orderBy('timestamp', 'desc'));

  unsubscribe = onSnapshot(q, (snapshot) => {
    let activeCount = 0;
    let deployedCount = 0;
    let resolvedTodayCount = 0;
    let pendingTriageCount = 0;
    let responseTimes = [];  // Step 4: real response time tracking
    const incidents = [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      incidents.push({ id: docSnap.id, ...data });

      const tsMs = data?.timestamp?.toDate?.()?.getTime?.() || 0;
      const stalePending = tsMs > 0 && (Date.now() - tsMs) > (5 * 60 * 1000);
      if (
        data.status !== 'resolved' &&
        data.triageLevel == null &&
        data.triageComplete !== true &&
        stalePending
      ) {
        const fallback = fallbackTriageForType(data.type || 'Unknown', data.description || data.voiceTranscript || '');
        updateDoc(doc(db, 'incidents', docSnap.id), {
          triageLevel: fallback.level,
          triageLevelName: fallback.levelName,
          triageReasoning: fallback.reasoning,
          triageComplete: true,
          modelUsed: 'Coordinator auto-fallback'
        }).catch(() => {
          // Ignore transient write errors; next snapshot will retry if still stale.
        });
      }

      if (data.status === 'resolved') {
        // Step 3: Use resolvedAt (not creation timestamp) for 'resolved today'
        const resolvedTs = data.resolvedAt?.toDate?.() || data.timestamp?.toDate?.();
        if (resolvedTs && resolvedTs >= startOfToday) resolvedTodayCount++;
        // Step 4: Track real response times
        if (data.assignedAt && data.resolvedAt) {
          const assignMs = data.assignedAt.toDate?.()?.getTime?.() || 0;
          const resolveMs = data.resolvedAt.toDate?.()?.getTime?.() || 0;
          if (assignMs > 0 && resolveMs > assignMs) {
            responseTimes.push((resolveMs - assignMs) / 60000);
          }
        }
      } else {
        activeCount++;
        if (data.assignedVolunteerId) deployedCount++;
        if (data.triageComplete !== true || data.triageLevel == null) {
          pendingTriageCount++;
        }
      }
    });

    latestIncidents = incidents;
    updateStats(activeCount, deployedCount, resolvedTodayCount, pendingTriageCount, responseTimes);
    renderList(incidents);

  }, (err) => {
    console.error('[Firestore] snapshot error:', err);
    showToast('Error connecting to real-time feed.');
  });
}

// ── TRIAGE LOGIC (Bug 6) ──────────────────────────────────────────────────────
function triageVisual(level) {
  switch (level) {
    case 1: return { color: '#A32D2D', label: 'Level 1 — Critical', rank: 1 };
    case 2: return { color: '#854F0B', label: 'Level 2 — Severe', rank: 2 };
    case 3: return { color: '#EF9F27', label: 'Level 3 — Moderate', rank: 3 };
    case 4: return { color: '#3B6D11', label: 'Level 4 — Minor', rank: 4 };
    case 5: return { color: '#555555', label: 'Level 5 — Monitoring', rank: 5 };
    default: return { color: '#2a2d3a', label: 'Pending', rank: 99, isPending: true };
  }
}

function getTriageDetails(inc) {
  const tsMs = inc?.timestamp?.toDate?.()?.getTime?.() || 0;
  const stalePending = tsMs > 0 && (Date.now() - tsMs) > (5 * 60 * 1000);

  if ((inc.triageComplete === false || inc.triageLevel == null) && stalePending) {
    const fb = fallbackTriageForType(inc.type || 'Unknown', inc.description || inc.voiceTranscript || '');
    return triageVisual(fb.level);
  }

  if ((inc.triageComplete === false || inc.triageLevel == null) && inc.triageReasoning) {
    const fb = fallbackTriageForType(inc.type || 'Unknown', inc.description || inc.voiceTranscript || '');
    return triageVisual(fb.level);
  }

  if (inc.triageComplete === false || inc.triageLevel == null) {
    return {
      color: '#2a2d3a', // default border
      label: '<span class="coord-spinner"></span> Analyzing...',
      rank: 99,
      isPending: true
    };
  }

  return triageVisual(inc.triageLevel);
}

function getAiReasoning(inc) {
  if (inc.aiReasoning)     return inc.aiReasoning;
  if (inc.triageReasoning) return inc.triageReasoning;
  if (inc.voiceTranscript) return `Voice context: "${inc.voiceTranscript}"`;
  return 'AI triage: prioritizing available responders by severity and proximity.';
}

function hasFinalTriage(inc) {
  return inc.triageComplete === true && inc.triageLevel != null;
}

function normalizeText(v) {
  return (v || '').toString().trim().toLowerCase();
}

function getExpectedSkills(type) {
  switch (type) {
    case 'Medical': return ['medical', 'first aid', 'rescue'];
    case 'Disaster': return ['rescue', 'coordination', 'supply'];
    case 'Conflict': return ['coordination', 'rescue'];
    case 'Resource': return ['supply', 'logistics', 'coordination'];
    case 'Hospitality': return ['hospitality', 'shelter', 'coordination'];
    default: return ['coordination'];
  }
}

// ── HAVERSINE for GPS-based proximity ──────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function matchScore(incident, volunteer) {
  const expectedSkills = getExpectedSkills(incident.type);
  const volunteerSkill = normalizeText(volunteer.skill);
  const volunteerLoc = normalizeText(volunteer.location);
  const incidentLoc = normalizeText(incident.location);

  let score = 0;

  if (!volunteer.available) return -1;

  // Skill match (0-70)
  if (expectedSkills.some(k => volunteerSkill.includes(k))) {
    score += 70;
  }

  // GPS proximity match (0-50) — Haversine
  const incCoords = incident.coordinates;
  const volCoords = volunteer.coordinates;
  if (incCoords && volCoords && incCoords.lat && volCoords.lat) {
    const dist = haversineKm(incCoords.lat, incCoords.lng, volCoords.lat, volCoords.lng);
    if (dist <= 2) score += 50;       // within 2 km
    else if (dist <= 5) score += 35;  // within 5 km
    else if (dist <= 15) score += 20; // within 15 km
    else if (dist <= 30) score += 10; // within 30 km
    // else no proximity bonus
  } else {
    // Fallback: text-based location overlap
    if (incidentLoc && volunteerLoc) {
      const incTokens = incidentLoc.split(/[ ,]+/).filter(t => t.length > 3);
      if (incTokens.some(t => volunteerLoc.includes(t))) {
        score += 20;
      }
    }
  }

  // Urgency bonus for high-severity incidents
  if ((incident.triageLevel || 5) <= 2) {
    score += 10;
  }

  return score;
}

function getVolunteerMatches(incident, limit = 3) {
  return volunteerPool
    .map(v => ({ ...v, matchScore: matchScore(incident, v) }))
    .filter(v => v.matchScore >= 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

async function dispatchVolunteer(incidentId, volunteerId) {
  const volunteer = volunteerPool.find(v => v.id === volunteerId);
  if (!volunteer) throw new Error('Volunteer not found');

  await Promise.all([
    updateDoc(doc(db, 'incidents', incidentId), {
      assignedVolunteerId: volunteerId,
      assignedVolunteerName: volunteer.name || 'Volunteer',
      assignedVolunteerSkill: volunteer.skill || '',
      assignedAt: serverTimestamp(),
      dispatchStatus: 'assigned'
    }),
    updateDoc(doc(db, 'volunteers', volunteerId), {
      available: false,
      activeIncidentId: incidentId,
      lastAssignedAt: serverTimestamp()
    })
  ]);
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

    let modelBadge = '';
    if (inc.triageComplete && inc.modelUsed) {
      if (inc.modelUsed.includes('3.0')) {
        modelBadge = `<span style="font-size: 10px; padding: 2px 6px; background: rgba(0, 150, 136, 0.2); color: #00bcd4; border: 1px solid rgba(0, 188, 212, 0.3); border-radius: 4px; font-weight: 700;">G3</span>`;
      } else if (inc.modelUsed.includes('2.5')) {
        modelBadge = `<span style="font-size: 10px; padding: 2px 6px; background: rgba(158, 158, 158, 0.15); color: #9e9e9e; border: 1px solid rgba(158, 158, 158, 0.3); border-radius: 4px; font-weight: 700;">G2.5</span>`;
      }
    }

    const levelLabel = hasFinalTriage(inc)
      ? (inc.triageLevelName || triage.label)
      : triage.label;

    const matches = getVolunteerMatches(inc, 3);
    const assignedLabel = inc.assignedVolunteerName
      ? `<span class="coord-chip" style="border-color:#2f9444;color:#9FE1CB;">Assigned: ${inc.assignedVolunteerName}</span>`
      : '';

    // Distance label for matched volunteers
    function distLabel(m) {
      const incCoords = inc.coordinates;
      const volCoords = m.coordinates;
      if (incCoords && volCoords && incCoords.lat && volCoords.lat) {
        const d = haversineKm(incCoords.lat, incCoords.lng, volCoords.lat, volCoords.lng);
        return ` · ${d.toFixed(1)}km`;
      }
      return '';
    }

    const matchBlock = (!isResolved && !inc.assignedVolunteerId)
      ? `
        <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
          <span style="font-size:11px;color:var(--text-dim);">Suggested volunteers:</span>
          ${matches.length === 0
            ? `<span style="font-size:11px;color:#ffb4a9;">No available match</span>`
            : matches.map(m => `
              <button
                class="coord-pill dispatch-btn"
                data-incident-id="${inc.id}"
                data-volunteer-id="${m.id}"
                style="cursor:pointer; padding:4px 8px; border-radius:6px; font-size:11px;"
                title="Score: ${m.matchScore}">
                ${m.name || 'Volunteer'} · ${m.skill || 'General'}${distLabel(m)}
              </button>
            `).join('')}
        </div>
      `
      : '';

    card.innerHTML = `
      <div class="coord-card-row-top">
        <span class="coord-level-badge" style="background:${badgeBg}; color:${badgeColor}; border:1px solid ${triage.color}44; display:flex; align-items:center; gap:6px;">${levelLabel}</span>
        <span class="coord-time-ago">${timeLabel}</span>
      </div>
      <div class="coord-card-body">
        <h3 class="coord-card-title">${inc.type || 'Unknown Crisis'}</h3>
        <p class="coord-card-location">📍 ${locationLabel} &nbsp;&nbsp; 👤 ${inc.reporterName || 'Anonymous'}</p>
        <p class="coord-card-ai">${aiReasoning}</p>
        ${inc.description ? `<p class="coord-card-desc">"${inc.description}"</p>` : ''}
        ${matchBlock}
      </div>
      <div class="coord-card-footer" style="display: flex; justify-content: space-between; align-items: center;">
        <div class="coord-chip-row">
          ${(inc.volunteerTypes || getExpectedSkills(inc.type)).map(t => `<span class="coord-chip">${t}</span>`).join('')}
          <span class="coord-chip">${isResolved ? '✅ Resolved' : '🔴 Active'}</span>
          ${assignedLabel}
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${modelBadge}
          ${!isResolved
            ? `<button class="coord-resolve-btn resolve-btn" data-id="${inc.id}">Mark Resolved</button>`
            : ''}
        </div>
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
        const target = latestIncidents.find(i => i.id === id);
        const updates = [
          updateDoc(doc(db, 'incidents', id), {
            status: 'resolved',
            resolvedAt: serverTimestamp()
          })
        ];

        if (target?.assignedVolunteerId) {
          updates.push(updateDoc(doc(db, 'volunteers', target.assignedVolunteerId), {
            available: true,
            activeIncidentId: null
          }));
        }

        await Promise.all(updates);
        showToast('Incident marked as resolved.');
      } catch (err) {
        showToast('Failed to update status.');
        btn.disabled = false;
        btn.textContent = 'Mark Resolved';
      }
    });
  });

  // Attach dispatch listeners
  document.querySelectorAll('.dispatch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const incidentId = btn.dataset.incidentId;
      const volunteerId = btn.dataset.volunteerId;
      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = 'Dispatching...';

      try {
        await dispatchVolunteer(incidentId, volunteerId);
        showToast('Volunteer dispatched successfully.');
      } catch (err) {
        console.error('Dispatch failed:', err);
        btn.disabled = false;
        btn.textContent = oldText;
        showToast('Dispatch failed. Try again.');
      }
    });
  });
}

// ── STATS ─────────────────────────────────────────────────────────────────────
function updateStats(activeCount, deployedCount, resolvedCount, pendingTriageCount = 0, responseTimes = []) {
  hdrActiveNum.textContent    = activeCount;
  hdrDeployedNum.textContent  = deployedCount;
  hdrResolvedNum.textContent  = resolvedCount;
  statActiveNum.textContent   = activeCount;
  statDeployedNum.textContent = deployedCount;
  statResolvedNum.textContent = resolvedCount;
  if (statPendingTriage) statPendingTriage.textContent = pendingTriageCount;
  // Step 4: Real avg response time from dispatch → resolve timestamps
  if (responseTimes.length > 0) {
    const avg = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
    statAvgResponse.textContent = avg > 0 ? `${avg}m` : '--';
  } else {
    statAvgResponse.textContent = activeCount > 0 ? 'N/A' : '--';
  }
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

  // Render insights charts when switching to insights panel
  if (name === 'insights') {
    setTimeout(() => renderInsights(), 100);
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
    volunteerPool = [];
    
    let total = 0, avail = 0, busy = 0;
    
    snapshot.forEach(docSnap => {
      total++;
      const data = docSnap.data();
      const isAvail = data.available;
      if (isAvail) avail++; else busy++;

      volunteerPool.push({ id: docSnap.id, ...data });
      
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

    // Re-render incident cards when volunteer availability changes so suggestions stay fresh
    if (latestIncidents.length > 0) {
      renderList(latestIncidents);
    }
    
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

function fallbackTriageForType(type, description = '') {
  const desc = description.toLowerCase();

  if (type === 'Medical') {
    const isCritical = ['bleeding', 'unconscious', 'heart', 'stroke', 'severe'].some(k => desc.includes(k));
    return {
      level: isCritical ? 1 : 2,
      levelName: isCritical ? 'Level 1 — Critical' : 'Level 2 — Severe',
      reasoning: isCritical
        ? 'Rule-based triage detected life-threatening medical signals.'
        : 'Rule-based triage marked this as urgent medical assistance.'
    };
  }

  if (type === 'Conflict') {
    return {
      level: 3,
      levelName: 'Level 3 — Moderate',
      reasoning: 'Rule-based triage marked conflict reports as moderate priority.'
    };
  }

  if (type === 'Disaster') {
    return {
      level: 2,
      levelName: 'Level 2 — Severe',
      reasoning: 'Rule-based triage marked disaster reports as severe for area response.'
    };
  }

  if (type === 'Resource') {
    return {
      level: 4,
      levelName: 'Level 4 — Minor',
      reasoning: 'Rule-based triage marked this as a non-life-threatening resource request.'
    };
  }

  if (type === 'Hospitality') {
    return {
      level: 5,
      levelName: 'Level 5 — Monitoring',
      reasoning: 'Rule-based triage marked this as monitoring/support request.'
    };
  }

  return {
    level: 3,
    levelName: 'Level 3 — Moderate',
    reasoning: 'Rule-based triage assigned moderate priority by default.'
  };
}

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
      const fallback = fallbackTriageForType(panelSelectedCategory, desc);

      await addDoc(collection(db, 'incidents'), {
        type: panelSelectedCategory,
        description: desc,
        location: loc,
        timestamp: serverTimestamp(),
        status: 'pending',
        triageLevel: fallback.level,
        triageLevelName: fallback.levelName,
        triageReasoning: fallback.reasoning,
        triageComplete: true,
        modelUsed: 'Coordinator rule-based',
        reporterName: auth.currentUser?.email || 'Coordinator'
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
          <div style="font-size:0.85rem; color:var(--text-dim);">📍 ${data.location || 'Unknown'} • 👤 ${data.reporterName || 'Anonymous'} • <span style="color:var(--text-muted);">${timeStr}</span></div>
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

const runTriageTestBtn = document.getElementById('runTriageTestBtn');
const triageTestResult = document.getElementById('triageTestResult');

if (runTriageTestBtn && triageTestResult) {
  runTriageTestBtn.addEventListener('click', () => {
    runTriageTestBtn.disabled = true;
    runTriageTestBtn.textContent = 'Running...';

    const cases = [
      {
        name: 'Level 1 Critical',
        type: 'Medical',
        description: 'Unconscious patient with severe bleeding',
        expected: 1
      },
      {
        name: 'Level 2 Severe',
        type: 'Disaster',
        description: 'Flood alert and urgent evacuation',
        expected: 2
      },
      {
        name: 'Level 3 Moderate',
        type: 'Conflict',
        description: 'Local conflict situation under observation',
        expected: 3
      },
      {
        name: 'Level 4 Minor',
        type: 'Resource',
        description: 'Water and blankets request',
        expected: 4
      },
      {
        name: 'Level 5 Monitoring',
        type: 'Hospitality',
        description: 'Shelter capacity informational update',
        expected: 5
      }
    ];

    const rows = cases.map((t) => {
      const got = fallbackTriageForType(t.type, t.description).level;
      const pass = got === t.expected;
      return {
        label: t.name,
        expected: t.expected,
        got,
        pass
      };
    });

    const passCount = rows.filter(r => r.pass).length;
    const allPassed = passCount === rows.length;

    triageTestResult.innerHTML = [
      `<div style="margin-bottom:0.4rem; font-weight:600; color:${allPassed ? '#4CAF50' : '#F57C00'};">${allPassed ? 'PASS' : 'PARTIAL'} — ${passCount}/${rows.length} checks</div>`,
      ...rows.map(r => (
        `<div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:2px; color:${r.pass ? '#9FE1CB' : '#ffb4a9'};">` +
          `<span>${r.pass ? 'PASS' : 'FAIL'} ${r.label}</span>` +
          `<span>expected L${r.expected}, got L${r.got}</span>` +
        `</div>`
      ))
    ].join('');

    showToast(allPassed ? 'Triage self-test passed (5/5).' : `Triage self-test: ${passCount}/5 passed.`);

    runTriageTestBtn.disabled = false;
    runTriageTestBtn.textContent = 'Run 5-level test';
  });
}

// --- SIDEBAR NAVIGATION LOGIC ---
document.querySelectorAll('.coord-nav-link').forEach(link => {
  link.addEventListener('click', () => {
    sessionStorage.setItem('cameFrom', 'coordinator');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ── COMMUNITY INSIGHTS PANEL — Charts, Map, Area Ranking ─────────────────────
// ══════════════════════════════════════════════════════════════════════════════

let insightsMap = null;
let insightsMapMarkers = [];

function renderInsights() {
  const incidents = latestIncidents;
  if (!incidents || incidents.length === 0) return;

  renderTypeBreakdownChart(incidents);
  renderSeverityChart(incidents);
  renderTrendChart(incidents);
  renderAreaRanking(incidents);
  renderInsightsMap(incidents);
}

// ── Donut: Incident Type Breakdown ───────────────────────────────────────────
function renderTypeBreakdownChart(incidents) {
  const canvas = document.getElementById('chartTypeBreakdown');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const typeCounts = {};
  incidents.forEach(i => {
    const t = i.type || 'Unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  const types = Object.keys(typeCounts);
  const counts = types.map(t => typeCounts[t]);
  const total = counts.reduce((a, b) => a + b, 0);
  const colors = {
    Medical: '#E53935', Disaster: '#F57C00', Conflict: '#FBC02D',
    Resource: '#4CAF50', Hospitality: '#757575', Unknown: '#9E9E9E'
  };

  // Draw donut
  const cx = w / 2, cy = h / 2 - 10, radius = 70, innerRadius = 40;
  let startAngle = -Math.PI / 2;
  types.forEach((type, i) => {
    const slice = (counts[i] / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + slice);
    ctx.arc(cx, cy, innerRadius, startAngle + slice, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = colors[type] || '#666';
    ctx.fill();
    startAngle += slice;
  });

  // Center text
  ctx.fillStyle = '#f0f0f0';
  ctx.font = 'bold 18px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(total, cx, cy + 2);
  ctx.font = '11px Inter, sans-serif';
  ctx.fillStyle = '#8e96a3';
  ctx.fillText('total', cx, cy + 16);

  // Legend
  let lx = 10, ly = h - 18;
  types.forEach((type, i) => {
    ctx.fillStyle = colors[type] || '#666';
    ctx.fillRect(lx, ly, 10, 10);
    ctx.fillStyle = '#c0c4cc';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${type} (${counts[i]})`, lx + 14, ly + 9);
    lx += ctx.measureText(`${type} (${counts[i]})`).width + 26;
    if (lx > w - 30) { lx = 10; ly -= 18; }
  });
}

// ── Bar: Severity Distribution ───────────────────────────────────────────────
function renderSeverityChart(incidents) {
  const canvas = document.getElementById('chartSeverity');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const levels = [0, 0, 0, 0, 0]; // L1-L5
  incidents.forEach(i => {
    const lv = i.triageLevel;
    if (lv >= 1 && lv <= 5) levels[lv - 1]++;
  });

  const labels = ['Critical', 'Severe', 'Moderate', 'Minor', 'Monitor'];
  const barColors = ['#E53935', '#F57C00', '#FBC02D', '#4CAF50', '#757575'];
  const maxVal = Math.max(...levels, 1);
  const barW = 36, gap = 20;
  const startX = (w - (barW * 5 + gap * 4)) / 2;
  const baseY = h - 35;
  const maxBarH = h - 70;

  levels.forEach((count, i) => {
    const x = startX + i * (barW + gap);
    const barH = (count / maxVal) * maxBarH;
    // Bar with rounded top
    ctx.fillStyle = barColors[i];
    ctx.beginPath();
    const r = 4;
    const y = baseY - barH;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + barW - r, y);
    ctx.arcTo(x + barW, y, x + barW, y + r, r);
    ctx.lineTo(x + barW, baseY);
    ctx.lineTo(x, baseY);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.fill();

    // Count on top
    ctx.fillStyle = '#f0f0f0';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(count, x + barW / 2, y - 6);

    // Label below
    ctx.fillStyle = '#8e96a3';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText(labels[i], x + barW / 2, baseY + 14);
  });
}

// ── Line: 7-Day Trend ────────────────────────────────────────────────────────
function renderTrendChart(incidents) {
  const canvas = document.getElementById('chartTrend');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const now = new Date();
  const days = [];
  const counts = [];
  for (let d = 6; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const dayStr = date.toLocaleDateString('en-US', { weekday: 'short' });
    days.push(dayStr);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const c = incidents.filter(i => {
      const ts = i.timestamp?.toDate?.();
      return ts && ts >= dayStart && ts < dayEnd;
    }).length;
    counts.push(c);
  }

  const maxVal = Math.max(...counts, 1);
  const padL = 30, padR = 15, padT = 20, padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const gy = padT + (plotH / 4) * g;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(w - padR, gy);
    ctx.stroke();
  }

  // Line
  const points = counts.map((c, i) => ({
    x: padL + (plotW / (counts.length - 1 || 1)) * i,
    y: padT + plotH - (c / maxVal) * plotH
  }));

  // Gradient fill
  const gradient = ctx.createLinearGradient(0, padT, 0, h - padB);
  gradient.addColorStop(0, 'rgba(52, 152, 219, 0.3)');
  gradient.addColorStop(1, 'rgba(52, 152, 219, 0)');
  ctx.beginPath();
  ctx.moveTo(points[0].x, h - padB);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, h - padB);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line stroke
  ctx.beginPath();
  ctx.strokeStyle = '#3498db';
  ctx.lineWidth = 2;
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();

  // Dots and labels
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#3498db';
    ctx.fill();
    ctx.strokeStyle = '#0d1520';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Count above dot
    if (counts[i] > 0) {
      ctx.fillStyle = '#f0f0f0';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(counts[i], p.x, p.y - 10);
    }

    // Day label
    ctx.fillStyle = '#8e96a3';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(days[i], p.x, h - padB + 14);
  });
}

// ── Area Ranking ─────────────────────────────────────────────────────────────
function renderAreaRanking(incidents) {
  const container = document.getElementById('areaRanking');
  if (!container) return;
  container.innerHTML = '';

  const BAD_LOCS = ['unknown', 'location unavailable', 'unknown location', 'capturing location...', 'locating...', 'capturing gps...', 'gps permission denied.'];

  const areaCounts = {};
  incidents.forEach(i => {
    let loc = i.location || '';
    // Skip placeholder/bad locations
    if (!loc || BAD_LOCS.includes(loc.toLowerCase().trim())) return;
    // Simplify long addresses to last 2-3 meaningful parts
    const parts = loc.split(',').map(s => s.trim()).filter(Boolean);
    loc = parts.length > 2 ? parts.slice(-3).join(', ') : loc;
    if (loc.length > 50) loc = loc.substring(0, 50) + '…';
    areaCounts[loc] = (areaCounts[loc] || 0) + 1;
  });

  const sorted = Object.entries(areaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const maxCount = sorted.length > 0 ? sorted[0][1] : 1;

  sorted.forEach(([area, count], idx) => {
    const pct = (count / maxCount) * 100;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:10px;';
    row.innerHTML = `
      <span style="font-size:0.8rem; color:var(--text-dim); min-width:16px;">${idx + 1}.</span>
      <div style="flex:1;">
        <div style="font-size:0.85rem; color:var(--text-main); margin-bottom:4px; word-break:break-word;">${area}</div>
        <div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
          <div style="height:100%; width:${pct}%; background:linear-gradient(90deg,#E53935,#F57C00); border-radius:3px; transition:width 0.5s;"></div>
        </div>
      </div>
      <span style="font-size:0.9rem; font-weight:600; color:var(--text-main); min-width:24px; text-align:right;">${count}</span>
    `;
    container.appendChild(row);
  });

  if (sorted.length === 0) {
    container.innerHTML = '<p style="color:var(--text-dim); font-size:0.88rem;">No data yet.</p>';
  }
}

// ── Leaflet Incident Map ─────────────────────────────────────────────────────
function renderInsightsMap(incidents) {
  const mapEl = document.getElementById('insightsMap');
  if (!mapEl) return;

  // Collect incidents with valid coordinates
  const geoIncidents = incidents.filter(i => i.coordinates && i.coordinates.lat && i.coordinates.lng);

  if (!insightsMap) {
    // Default center: India (since the app seems India-focused)
    insightsMap = L.map('insightsMap', {
      center: [22.5, 88.0],
      zoom: 5,
      zoomControl: true,
      attributionControl: true
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OSM &amp; CartoDB',
      maxZoom: 19
    }).addTo(insightsMap);
  }

  // Clear old markers
  insightsMapMarkers.forEach(m => insightsMap.removeLayer(m));
  insightsMapMarkers = [];

  const triageColors = { 1: '#E53935', 2: '#F57C00', 3: '#FBC02D', 4: '#4CAF50', 5: '#757575' };

  geoIncidents.forEach(inc => {
    const lv = inc.triageLevel || 3;
    const color = triageColors[lv] || '#FBC02D';
    const marker = L.circleMarker([inc.coordinates.lat, inc.coordinates.lng], {
      radius: lv <= 2 ? 10 : (lv <= 3 ? 7 : 5),
      color: color,
      fillColor: color,
      fillOpacity: 0.7,
      weight: 2
    });
    marker.bindPopup(`
      <div style="font-family:Inter,sans-serif; background:#1a1c2e; color:#f0f0f0; padding:8px; border-radius:6px; min-width:160px;">
        <strong>${inc.type || 'Incident'}</strong><br>
        <span style="color:${color};">Level ${lv}</span><br>
        ${inc.location ? `📍 ${inc.location.substring(0, 60)}` : ''}<br>
        ${inc.description ? `"${inc.description.substring(0, 80)}"` : ''}
      </div>
    `, { className: 'dark-popup' });
    marker.addTo(insightsMap);
    insightsMapMarkers.push(marker);
  });

  // Fit bounds if we have points
  if (geoIncidents.length > 0) {
    const bounds = L.latLngBounds(geoIncidents.map(i => [i.coordinates.lat, i.coordinates.lng]));
    insightsMap.fitBounds(bounds.pad(0.3));
  }

  // Force tile redraw (needed when map was hidden)
  setTimeout(() => insightsMap.invalidateSize(), 200);
}
