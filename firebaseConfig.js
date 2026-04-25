// =====================================================
// firebaseConfig.js — ResQNet Firebase Initialization
// =====================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAgSylHSHd1KRN4SYNqG30cQkrGRfY2CCI",
  authDomain: "resqnet-e74e0.firebaseapp.com",
  projectId: "resqnet-e74e0",
  storageBucket: "resqnet-e74e0.firebasestorage.app",
  messagingSenderId: "206471236870",
  appId: "1:206471236870:web:807c01c54ef0adb332a287",
  measurementId: "G-79KC3T537B"
};

const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);
export const auth = getAuth(app);

// Re-export auth helpers for coordinator login
export { signInWithEmailAndPassword, signOut, onAuthStateChanged };

// Sign in anonymously — used by reporter page so Firestore rules can reference auth.uid
export async function ensureAuth() {
  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
  } catch (e) {
    console.warn("Anonymous auth failed:", e.message);
  }
}
