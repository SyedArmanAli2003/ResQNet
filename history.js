import { db, ensureAuth } from './firebaseConfig.js';
import { collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const historyList = document.getElementById('historyList');
const filterTabs = document.querySelectorAll('.filter-tab');
const statTotal = document.getElementById('statTotal');
const statPending = document.getElementById('statPending');
const statResolved = document.getElementById('statResolved');

let activeFilter = 'all';

// --- INIT ---
async function init() {
  await ensureAuth();
  listenToHistory();
}
init();

// --- RELATIVE TIME ---
function timeAgo(date) {
  if (!date) return 'just now';
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60)  return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`;
  return `${Math.floor(seconds/86400)}d ago`;
}

function getSeverity(type) {
  switch(type) {
    case 'Medical': return { color: '#E53935', icon: '🏥' };
    case 'Disaster': return { color: '#F57C00', icon: '🌊' };
    case 'Conflict': return { color: '#FBC02D', icon: '⚔️' };
    case 'Resource': return { color: '#4CAF50', icon: '📦' };
    case 'Hospitality': return { color: '#757575', icon: '🏠' };
    default: return { color: '#A32D2D', icon: '🆘' };
  }
}

// --- REAL-TIME FEED ---
function listenToHistory() {
  const q = query(collection(db, 'incidents'), orderBy('timestamp', 'desc'));

  onSnapshot(q, (snapshot) => {
    historyList.innerHTML = '';
    
    let totalCount = 0;
    let pendingCount = 0;
    let resolvedCount = 0;
    let renderCount = 0;

    snapshot.forEach(docSnap => {
      totalCount++;
      const data = docSnap.data();
      const status = data.status || 'pending';
      
      if (status === 'resolved') resolvedCount++;
      else pendingCount++;

      // Apply filter
      if (activeFilter !== 'all' && status !== activeFilter) return;
      
      renderCount++;

      const severity = getSeverity(data.type);
      const timeStr = timeAgo(data.timestamp?.toDate());
      
      let statusBadge = '';
      if (status === 'resolved') {
        statusBadge = `<span class="status-badge status-resolved">Resolved</span>`;
      } else {
        statusBadge = `<span class="status-badge status-pending">Pending</span>`;
      }
      
      let aiSection = '';
      if (data.triageLevel !== null && data.triageLevel !== undefined) {
        aiSection = `<div class="hc-ai">AI Triage Level: ${data.triageLevel}</div>`;
      } else if (data.aiReasoning || data.triageReasoning) {
        aiSection = `<div class="hc-ai">${data.aiReasoning || data.triageReasoning}</div>`;
      }

      const card = document.createElement('div');
      card.className = 'history-card';
      card.style.borderLeftColor = severity.color;
      
      card.innerHTML = `
        <div class="hc-top">
          <div class="hc-title">${severity.icon} ${data.type || 'Emergency'}</div>
          <div class="hc-time">${timeStr}</div>
        </div>
        <div class="hc-loc">📍 ${data.location || 'Unknown location'}</div>
        <div>${statusBadge}</div>
        ${aiSection}
      `;
      historyList.appendChild(card);
    });

    statTotal.textContent = totalCount;
    statPending.textContent = pendingCount;
    statResolved.textContent = resolvedCount;

    if (renderCount === 0) {
      historyList.innerHTML = '<p style="color: var(--text-dim); padding: 2rem 0; text-align: center;">No incidents reported yet.</p>';
    }
  }, (err) => {
    console.error('Listen failed:', err);
    historyList.innerHTML = '<p style="color: #ff6b6b; padding: 2rem 0;">Error loading history.</p>';
  });
}

// --- FILTERS ---
filterTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    filterTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeFilter = tab.dataset.status;
    // Re-trigger render
    listenToHistory();
  });
});

// --- BACK NAVIGATION LOGIC ---
const backLink = document.querySelector('.back-link');
if (backLink) {
  const cameFrom = sessionStorage.getItem('cameFrom');
  if (cameFrom === 'reporter') {
    backLink.href = 'reporter.html';
  } else if (cameFrom === 'coordinator') {
    backLink.href = 'coordinator.html';
  } else {
    backLink.href = 'reporter.html';
  }
}
