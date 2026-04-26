import { auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile, onAuthStateChanged } from './firebaseConfig.js';
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// --- DOM Elements ---
const tabs = document.querySelectorAll('.auth-tab');
const forms = document.querySelectorAll('.auth-form');
const signinForm = document.getElementById('signinForm');
const signupForm = document.getElementById('signupForm');
const forgotPwd = document.getElementById('forgotPwd');
const siError = document.getElementById('siError');
const suError = document.getElementById('suError');
const toast = document.getElementById('toast');

// --- Tab Switching ---
if (tabs) {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      forms.forEach(f => f.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.target + 'Form').classList.add('active');
      siError.style.display = 'none';
      suError.style.display = 'none';
    });
  });
}

function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

// --- Sign In ---
if (signinForm) {
  signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    siError.style.display = 'none';
    const email = document.getElementById('siEmail').value;
    const password = document.getElementById('siPassword').value;

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // Fetch profile
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        sessionStorage.setItem('userProfile', JSON.stringify(docSnap.data()));
      }
      
      window.location.href = 'reporter.html';
    } catch (error) {
      console.error(error);
      let msg = 'Sign in failed.';
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        msg = 'Invalid email or password.';
      } else if (error.code === 'auth/too-many-requests') {
        msg = 'Too many failed attempts. Try again later.';
      }
      showError(siError, msg);
    }
  });
}

// --- Sign Up ---
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    suError.style.display = 'none';
    
    const name = document.getElementById('suName').value.trim();
    const email = document.getElementById('suEmail').value.trim();
    const phone = document.getElementById('suPhone').value.trim();
    const address = document.getElementById('suAddress').value.trim();
    const password = document.getElementById('suPassword').value;
    const confirm = document.getElementById('suConfirm').value;
    const btn = document.getElementById('btnCreateAccount');

    if (password !== confirm) {
      return showError(suError, 'Passwords do not match.');
    }
    if (password.length < 8) {
      return showError(suError, 'Password must be at least 8 characters.');
    }

    try {
      btn.textContent = 'Creating...';
      btn.disabled = true;

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: name });

      const profile = {
        uid: user.uid,
        fullName: name,
        email: email,
        phone: phone,
        address: address,
        role: "reporter",
        createdAt: serverTimestamp(),
        totalReports: 0,
        avatar: ""
      };

      await setDoc(doc(db, 'users', user.uid), profile);
      sessionStorage.setItem('userProfile', JSON.stringify(profile));

      window.location.href = 'reporter.html';
    } catch (error) {
      console.error(error);
      btn.textContent = 'Create Account';
      btn.disabled = false;
      let msg = 'Registration failed.';
      if (error.code === 'auth/email-already-in-use') {
        msg = 'Email already exists. Try signing in instead.';
      } else if (error.code === 'auth/weak-password') {
        msg = 'Password is too weak.';
      }
      showError(suError, msg);
    }
  });
}

// --- Forgot Password ---
if (forgotPwd) {
  forgotPwd.addEventListener('click', async () => {
    const email = document.getElementById('siEmail').value.trim();
    if (!email) {
      showError(siError, 'Please enter your email address first.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      showToast('Password reset email sent.');
      siError.style.display = 'none';
    } catch (error) {
      console.error(error);
      showError(siError, 'Failed to send reset email.');
    }
  });
}

// --- Global Auth State and Redirects ---
onAuthStateChanged(auth, async (user) => {
  const isAuthPage = window.location.pathname.includes('auth.html');
  const isReporterPage = window.location.pathname.includes('reporter.html');

  if (user) {
    if (isAuthPage) {
      window.location.href = 'reporter.html';
    }
    // Refresh profile in sessionStorage if missing
    if (!sessionStorage.getItem('userProfile')) {
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        sessionStorage.setItem('userProfile', JSON.stringify(docSnap.data()));
        // If on reporter page, UI update might be needed, handled in app.js
      }
    }
  } else {
    if (isReporterPage) {
      window.location.href = 'auth.html';
    }
  }
});

// Helper for other files
export function getCurrentUser() {
  const profileStr = sessionStorage.getItem('userProfile');
  if (profileStr) {
    try {
      return JSON.parse(profileStr);
    } catch (e) {
      return null;
    }
  }
  return null;
}
