// =====================================================
// firebaseConfig.js — ResQNet Firebase Initialization
// REPLACE the values below with your actual Firebase
// project config from the Firebase Console.
// =====================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Sign in anonymously so Firestore security rules can reference auth.uid
export async function ensureAuth() {
  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
  } catch (e) {
    console.warn("Anonymous auth failed:", e.message);
  }
}
