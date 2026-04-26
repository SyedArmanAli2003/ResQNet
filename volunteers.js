import { db, ensureAuth } from './firebaseConfig.js';
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const volForm = document.getElementById('volForm');
const volList = document.getElementById('volList');
const filterBtns = document.querySelectorAll('.filter-btn');
const locInput = document.getElementById('volLoc');
const locStatus = document.getElementById('locStatus');
const submitVol = document.getElementById('submitVol');

let activeFilter = 'All';

// --- INIT ---
async function init() {
  await ensureAuth();
  captureLocation();
  listenToVolunteers();
}
init();

// --- GPS ---
function captureLocation() {
  if (!navigator.geolocation) {
    locStatus.textContent = '(GPS not supported)';
    locInput.placeholder = 'Enter your location manually';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      locInput.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      locStatus.textContent = '';
      
      // Try to get address
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.display_name) {
            locInput.value = data.display_name;
          }
        }
      } catch(e) {
        // Fallback to coords already set
      }
    },
    (err) => {
      locStatus.textContent = '(GPS failed)';
      locInput.placeholder = 'Enter location manually';
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
}

// --- FORM SUBMISSION ---
volForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitVol.disabled = true;
  submitVol.textContent = 'Registering...';

  try {
    await addDoc(collection(db, 'volunteers'), {
      name: document.getElementById('volName').value.trim(),
      phone: document.getElementById('volPhone').value.trim(),
      skill: document.getElementById('volSkill').value,
      location: locInput.value.trim(),
      available: document.getElementById('volAvail').checked,
      registeredAt: serverTimestamp()
    });
    
    showToast('Registered successfully!');
    volForm.reset();
    captureLocation(); // re-fetch GPS after reset
  } catch(e) {
    console.error('Registration failed:', e);
    showToast('Registration failed. Try again.');
  } finally {
    submitVol.disabled = false;
    submitVol.textContent = 'Register';
  }
});

// --- REAL-TIME FEED ---
function listenToVolunteers() {
  const q = query(collection(db, 'volunteers'), orderBy('registeredAt', 'desc'));

  onSnapshot(q, (snapshot) => {
    volList.innerHTML = '';
    let count = 0;

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      // Apply filter
      if (activeFilter !== 'All' && data.skill !== activeFilter) return;
      count++;

      const initials = data.name ? data.name.substring(0,2).toUpperCase() : '??';
      const isAvail = data.available;
      
      const card = document.createElement('div');
      card.className = 'vol-card';
      card.innerHTML = `
        <div class="vol-avatar">${initials}</div>
        <div class="vol-info">
          <h3 class="vol-name">${data.name}</h3>
          <p class="vol-loc">📍 ${data.location}</p>
          <div class="vol-status-row">
            <span class="coord-chip">${data.skill}</span>
            <span style="font-size:0.85rem; color:var(--text-dim); display:flex; align-items:center;">
              <span class="availability-dot ${isAvail ? 'dot-avail' : 'dot-busy'}"></span>
              ${isAvail ? 'Available' : 'Busy'}
            </span>
          </div>
        </div>
      `;
      volList.appendChild(card);
    });

    if (count === 0) {
      volList.innerHTML = '<p style="color: var(--text-dim); padding: 2rem 0; width: 100%;">No volunteers yet.</p>';
    }
  }, (err) => {
    console.error('Listen failed:', err);
    volList.innerHTML = '<p style="color: #ff6b6b; padding: 2rem 0;">Error loading volunteers.</p>';
  });
}

// --- FILTERS ---
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    // Re-trigger render
    listenToVolunteers();
  });
});

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
