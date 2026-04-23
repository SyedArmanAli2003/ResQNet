import { db, ensureAuth } from './firebaseConfig.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// DOM Elements
const sosBtn = document.getElementById('sosBtn');
const sosProgress = document.getElementById('sosProgress');
const categoryModal = document.getElementById('categoryModal');
const modalGpsStatus = document.getElementById('modalGpsStatus');
const catBtns = document.querySelectorAll('.cat-btn');
const modalDesc = document.getElementById('modalDesc');
const modalSubmit = document.getElementById('modalSubmit');
const modalCancel = document.getElementById('modalCancel');

const reportForm = document.getElementById('reportForm');
const locationField = document.getElementById('locationField');
const getGpsBtn = document.getElementById('getGpsBtn');
const coordsDisplay = document.getElementById('coordsDisplay');

const voiceSection = document.getElementById('voiceSection');
const voiceText = document.getElementById('voiceText');
const voiceBanner = document.getElementById('voiceBanner');
const voiceBannerText = document.getElementById('voiceBannerText');

let holdTimer;
let isHolding = false;
let currentCoords = null;
let currentAddress = "";
let selectedCategory = "";
let voiceTranscript = "";

// Initialize App
async function init() {
  await ensureAuth();
}
init();

// --- TOAST UTILITY ---
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// --- GPS UTILITY ---
async function fetchAddress(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch (err) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

async function captureGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        currentCoords = { lat: latitude, lng: longitude };
        currentAddress = await fetchAddress(latitude, longitude);
        resolve({ coords: currentCoords, address: currentAddress });
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// --- VOICE RECOGNITION (5 SECONDS) ---
function startVoiceCapture() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.log("Speech recognition not supported in this browser.");
    voiceBanner.style.display = 'none';
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  voiceBanner.style.display = 'flex';
  voiceBannerText.textContent = "🎙 Listening for 5s... speak now";
  
  recognition.onresult = (event) => {
    let interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        voiceTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    voiceBannerText.textContent = `🎙 "${voiceTranscript || interimTranscript}"`;
  };

  recognition.onerror = (event) => {
    console.warn("Speech recognition error", event.error);
    voiceBannerText.textContent = "🎙 Recording failed or cancelled";
  };

  recognition.start();

  // Stop after 5 seconds
  setTimeout(() => {
    try {
      recognition.stop();
      voiceBanner.style.display = 'none';
      if (voiceTranscript) {
        // Show in manual form if user cancels modal
        voiceSection.style.display = 'flex';
        voiceText.textContent = `"${voiceTranscript}"`;
      }
    } catch(e) {}
  }, 5000);
}


// --- SOS BUTTON HOLD LOGIC ---
function startHold(e) {
  // Ignore right clicks
  if (e.type === 'mousedown' && e.button !== 0) return;
  
  isHolding = true;
  sosBtn.classList.add('holding');
  
  holdTimer = setTimeout(() => {
    if (isHolding) {
      sosBtn.classList.remove('holding');
      triggerSOS();
    }
  }, 2000);
}

function endHold() {
  if (isHolding) {
    isHolding = false;
    clearTimeout(holdTimer);
    sosBtn.classList.remove('holding');
  }
}

sosBtn.addEventListener('mousedown', startHold);
sosBtn.addEventListener('touchstart', startHold, { passive: true });
window.addEventListener('mouseup', endHold);
window.addEventListener('touchend', endHold);

async function triggerSOS() {
  // Vibrate if supported
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  
  modalGpsStatus.textContent = "📍 Capturing GPS...";
  categoryModal.hidden = false;
  
  // Clear previous state
  selectedCategory = "";
  voiceTranscript = "";
  catBtns.forEach(b => b.classList.remove('selected'));
  modalDesc.value = "";
  voiceBanner.style.display = 'none';
  
  try {
    const { address } = await captureGps();
    modalGpsStatus.textContent = `📍 ${address}`;
    locationField.value = address;
    coordsDisplay.textContent = `${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)}`;
    
    // Start 5-second voice capture
    startVoiceCapture();
  } catch (err) {
    modalGpsStatus.textContent = "📍 GPS failed (ensure permissions)";
  }
}

// --- MODAL CATEGORY SELECTION ---
catBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    catBtns.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedCategory = btn.dataset.type;
  });
});

modalCancel.addEventListener('click', () => {
  categoryModal.hidden = true;
});

// --- SUBMITTING INCIDENT TO FIRESTORE ---
async function saveIncident(type, description, locationStr, coords, vTranscript = "") {
  try {
    const docRef = await addDoc(collection(db, "incidents"), {
      type: type,
      description: description,
      location: locationStr || "Unknown Location",
      coordinates: coords || { lat: 0, lng: 0 },
      timestamp: serverTimestamp(),
      status: "pending",
      triageLevel: null,
      voiceTranscript: vTranscript
    });
    return docRef.id;
  } catch (e) {
    console.error("Error adding document: ", e);
    throw e;
  }
}

modalSubmit.addEventListener('click', async () => {
  if (!selectedCategory) {
    showToast("Please select a crisis category.");
    return;
  }
  
  modalSubmit.disabled = true;
  modalSubmit.textContent = "Sending...";
  
  try {
    await saveIncident(
      selectedCategory, 
      modalDesc.value, 
      currentAddress, 
      currentCoords,
      voiceTranscript
    );
    showToast("Emergency reported successfully.");
    categoryModal.hidden = true;
  } catch (err) {
    showToast("Failed to send report.");
  } finally {
    modalSubmit.disabled = false;
    modalSubmit.textContent = "Send SOS Report";
  }
});

// --- MANUAL FORM LOGIC ---
getGpsBtn.addEventListener('click', async () => {
  getGpsBtn.disabled = true;
  try {
    const { address, coords } = await captureGps();
    locationField.value = address;
    coordsDisplay.textContent = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    showToast("GPS location updated.");
  } catch (err) {
    showToast("Could not capture GPS.");
  }
  getGpsBtn.disabled = false;
});

reportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const type = document.getElementById('crisisType').value;
  const desc = document.getElementById('description').value;
  const loc = locationField.value;
  const submitBtn = document.getElementById('submitBtn');
  const submitLabel = document.getElementById('submitLabel');
  const submitSpinner = document.getElementById('submitSpinner');
  
  submitBtn.disabled = true;
  submitLabel.style.display = 'none';
  submitSpinner.style.display = 'block';
  
  try {
    await saveIncident(type, desc, loc, currentCoords, voiceTranscript);
    showToast("Report submitted successfully.");
    reportForm.reset();
    coordsDisplay.textContent = "";
    voiceSection.style.display = 'none';
    voiceTranscript = "";
    currentCoords = null;
    currentAddress = "";
  } catch (err) {
    showToast("Failed to submit report.");
  } finally {
    submitBtn.disabled = false;
    submitLabel.style.display = 'block';
    submitSpinner.style.display = 'none';
  }
});
