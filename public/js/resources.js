import { db } from './firebaseConfig.js';
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const resList = document.getElementById('resList');
const addResBtn = document.getElementById('addResBtn');
const resModal = document.getElementById('resModal');
const cancelRes = document.getElementById('cancelRes');
const resForm = document.getElementById('resForm');
const submitRes = document.getElementById('submitRes');

async function ensureResourceSession() {
  const auth = getAuth();
  if (auth.currentUser) return;
  await signInAnonymously(auth);
}

// --- INIT ---
async function init() {
  try {
    await ensureResourceSession();
    listenToResources();
  } catch (err) {
    console.error('Resource auth/init failed:', err);
    resList.innerHTML = '<p style="color: #ff6b6b; padding: 2rem 0;">Unable to connect to resources service.</p>';
  }
}
init();

// --- MODAL ---
addResBtn.addEventListener('click', () => {
  resModal.style.display = 'flex';
});

cancelRes.addEventListener('click', () => {
  resModal.style.display = 'none';
  resForm.reset();
});

// --- FORM SUBMISSION ---
resForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitRes.disabled = true;
  submitRes.textContent = 'Adding...';

  try {
    await ensureResourceSession();
    await addDoc(collection(db, 'resources'), {
      name: document.getElementById('rName').value.trim(),
      type: document.getElementById('rType').value,
      contact: document.getElementById('rContact').value.trim(),
      address: document.getElementById('rAddress').value.trim(),
      timestamp: serverTimestamp()
    });
    
    showToast('Resource added successfully!');
    resModal.style.display = 'none';
    resForm.reset();
  } catch(e) {
    console.error('Failed to add resource:', e);
    showToast('Failed to add resource. Try again.');
  } finally {
    submitRes.disabled = false;
    submitRes.textContent = 'Add Resource';
  }
});

// --- REAL-TIME FEED ---
function listenToResources() {
  const q = query(collection(db, 'resources'), orderBy('timestamp', 'desc'));

  onSnapshot(q, (snapshot) => {
    resList.innerHTML = '';
    let count = 0;

    snapshot.forEach(docSnap => {
      count++;
      const data = docSnap.data();
      
      const card = document.createElement('div');
      card.className = 'res-card';
      
      // Clean up link for tel:
      const rawNum = data.contact.replace(/[^\d+]/g, '');
      
      card.innerHTML = `
        <div>
          <div class="res-title-row">
            <span class="res-name">${data.name}</span>
            <span class="res-type">${data.type}</span>
          </div>
          <div class="res-meta">📍 ${data.address}</div>
        </div>
        <a href="tel:${rawNum}" class="res-contact">📞 ${data.contact}</a>
      `;
      resList.appendChild(card);
    });

    if (count === 0) {
      resList.innerHTML = '<p style="color: var(--text-dim); padding: 2rem 0; width: 100%;">No community resources added yet.</p>';
    }
  }, (err) => {
    console.error('Listen failed:', err);
    resList.innerHTML = '<p style="color: #ff6b6b; padding: 2rem 0;">Error loading resources.</p>';
  });
}

// --- TOAST ---
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  t.style.backgroundColor = '#2e7d32'; // green
  setTimeout(() => t.classList.remove('show'), 3000);
}

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
