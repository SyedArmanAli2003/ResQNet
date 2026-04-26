import { 
  auth, db, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail, 
  updateProfile, 
  onAuthStateChanged 
} from './firebaseConfig.js';
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

console.log('[Auth] auth.js loaded');

// ─── REDIRECT if already signed in ──────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (user && window.location.pathname.includes('auth.html')) {
    console.log('[Auth] Already signed in, redirecting to reporter.html');
    window.location.href = 'reporter.html';
  }
});

// ─── HELPER ─────────────────────────────────────────────────────────────────
function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
  console.error('[Auth] Error shown:', message);
}

function hideError(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.style.display = 'none';
}

// ─── DOM SETUP ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Auth] DOM ready');

  // Tab switching
  const tabs = document.querySelectorAll('.auth-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.panel);
      if (target) target.classList.add('active');
      hideError('signInError');
      hideError('createError');
    });
  });

  // Grab buttons
  const signInBtn = document.getElementById('signInBtn');
  const createBtn = document.getElementById('createBtn');
  const forgotPwdLink = document.getElementById('forgotPwdLink');

  if (!signInBtn) console.error('[Auth] signInBtn not found');
  if (!createBtn) console.error('[Auth] createBtn not found');

  // ── SIGN IN ────────────────────────────────────────────────────────────────
  if (signInBtn) {
    signInBtn.addEventListener('click', async () => {
      console.log('[Auth] Sign in clicked');
      hideError('signInError');

      const email    = document.getElementById('signInEmail')?.value?.trim();
      const password = document.getElementById('signInPassword')?.value;

      if (!email || !password) {
        showError('signInError', 'Please fill in all fields');
        return;
      }

      signInBtn.textContent = 'Signing in...';
      signInBtn.disabled = true;

      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        console.log('[Auth] Sign in success:', cred.user.email);

        // Cache profile
        const snap = await getDoc(doc(db, 'users', cred.user.uid));
        if (snap.exists()) {
          sessionStorage.setItem('userProfile', JSON.stringify({ ...snap.data(), uid: cred.user.uid }));
        }

        window.location.href = 'reporter.html';
      } catch (err) {
        console.error('[Auth] Sign in error:', err.code);
        signInBtn.textContent = 'Sign In';
        signInBtn.disabled = false;
        const messages = {
          'auth/user-not-found':    'No account found with this email',
          'auth/wrong-password':    'Wrong password',
          'auth/invalid-credential':'Invalid email or password',
          'auth/too-many-requests': 'Too many attempts — try again later',
          'auth/invalid-email':     'Invalid email format'
        };
        showError('signInError', messages[err.code] || 'Sign in failed: ' + err.message);
      }
    });
  }

  // ── CREATE ACCOUNT ─────────────────────────────────────────────────────────
  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      console.log('[Auth] Create account clicked');
      hideError('createError');

      const name     = document.getElementById('regName')?.value?.trim();
      const email    = document.getElementById('regEmail')?.value?.trim();
      const phone    = document.getElementById('regPhone')?.value?.trim();
      const address  = document.getElementById('regAddress')?.value?.trim();
      const password = document.getElementById('regPassword')?.value;
      const confirm  = document.getElementById('regConfirm')?.value;

      if (!name || !email || !phone || !password || !confirm) {
        showError('createError', 'Please fill in all fields');
        return;
      }
      if (password.length < 8) {
        showError('createError', 'Password must be at least 8 characters');
        return;
      }
      if (password !== confirm) {
        showError('createError', 'Passwords do not match');
        return;
      }

      createBtn.textContent = 'Creating account...';
      createBtn.disabled = true;

      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        console.log('[Auth] Account created:', cred.user.uid);

        await updateProfile(cred.user, { displayName: name });

        const profile = {
          uid: cred.user.uid,
          fullName: name,
          email: email,
          phone: phone,
          address: address || '',
          role: 'reporter',
          createdAt: serverTimestamp(),
          totalReports: 0,
          avatar: ''
        };

        await setDoc(doc(db, 'users', cred.user.uid), profile);
        console.log('[Auth] Firestore profile saved');

        sessionStorage.setItem('userProfile', JSON.stringify({ ...profile, uid: cred.user.uid }));
        window.location.href = 'reporter.html';
      } catch (err) {
        console.error('[Auth] Create error:', err.code);
        createBtn.textContent = 'Create Account';
        createBtn.disabled = false;
        const messages = {
          'auth/email-already-in-use': 'Email already registered — try signing in',
          'auth/invalid-email':        'Invalid email format',
          'auth/weak-password':        'Password too weak'
        };
        showError('createError', messages[err.code] || 'Error: ' + err.message);
      }
    });
  }

  // ── FORGOT PASSWORD ─────────────────────────────────────────────────────────
  if (forgotPwdLink) {
    forgotPwdLink.addEventListener('click', async () => {
      const email = document.getElementById('signInEmail')?.value?.trim();
      if (!email) {
        showError('signInError', 'Enter your email address above first');
        return;
      }
      try {
        await sendPasswordResetEmail(auth, email);
        hideError('signInError');
        const toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = 'Password reset email sent!';
          toast.classList.add('show');
          setTimeout(() => toast.classList.remove('show'), 3000);
        }
      } catch (err) {
        console.error(err);
        showError('signInError', 'Failed to send reset email');
      }
    });
  }
});

// ─── EXPORT helper ───────────────────────────────────────────────────────────
export function getCurrentUser() {
  try {
    const s = sessionStorage.getItem('userProfile');
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
