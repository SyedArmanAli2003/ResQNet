import { auth, db, onAuthStateChanged, updateProfile } from './firebaseConfig.js';
import { 
  EmailAuthProvider, 
  reauthenticateWithCredential, 
  updatePassword, 
  deleteUser 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
  doc, 
  getDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  getDocs,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const toast = document.getElementById('toast');
function showToast(msg, isError = false) {
  if (!toast) return;
  toast.textContent = msg;
  toast.style.background = isError ? 'var(--red)' : 'var(--teal)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }

  // Load user profile
  const userDocRef = doc(db, 'users', user.uid);
  const userDoc = await getDoc(userDocRef);
  const profile = userDoc.exists() ? userDoc.data() : null;

  const name = profile?.fullName || user.displayName || 'User';
  const email = user.email || '';
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // Populate UI
  document.getElementById('accName').textContent = name;
  document.getElementById('accEmail').textContent = email;
  document.getElementById('accAvatar').textContent = initials;
  
  if (profile?.createdAt) {
    const date = profile.createdAt.toDate();
    document.getElementById('accSince').textContent = date.toLocaleDateString();
  }

  // Count incidents
  const q = query(collection(db, 'incidents'), where('reportedBy', '==', user.uid));
  const snap = await getDocs(q);
  document.getElementById('accReports').textContent = snap.size;

  // Pre-fill form
  if (profile) {
    document.getElementById('editName').value = profile.fullName || '';
    document.getElementById('editPhone').value = profile.phone || '';
    document.getElementById('editAddress').value = profile.address || '';
  }

  // Handle Edit Profile
  document.getElementById('editProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnSaveProfile');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const newName = document.getElementById('editName').value.trim();
    const newPhone = document.getElementById('editPhone').value.trim();
    const newAddress = document.getElementById('editAddress').value.trim();

    try {
      await updateDoc(userDocRef, {
        fullName: newName,
        phone: newPhone,
        address: newAddress
      });
      await updateProfile(user, { displayName: newName });
      
      // Update UI
      document.getElementById('accName').textContent = newName;
      document.getElementById('accAvatar').textContent = newName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
      
      showToast('Profile updated!');
    } catch (err) {
      console.error(err);
      showToast('Failed to update profile.', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save changes';
    }
  });

  // Handle Change Password
  const pwdError = document.getElementById('pwdError');
  document.getElementById('changePwdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    pwdError.style.display = 'none';
    const btn = document.getElementById('btnUpdatePwd');
    
    const currentPwd = document.getElementById('currentPwd').value;
    const newPwd = document.getElementById('newPwd').value;
    const confirmPwd = document.getElementById('confirmNewPwd').value;

    if (newPwd !== confirmPwd) {
      pwdError.textContent = 'New passwords do not match.';
      pwdError.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Updating...';

    try {
      const credential = EmailAuthProvider.credential(user.email, currentPwd);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPwd);
      showToast('Password updated!');
      document.getElementById('changePwdForm').reset();
    } catch (err) {
      console.error(err);
      pwdError.textContent = 'Incorrect current password or update failed.';
      pwdError.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update password';
    }
  });

  // Handle Delete Account
  document.getElementById('btnDeleteAccount').addEventListener('click', async () => {
    const confirmDelete = confirm("Are you sure? This will delete your account and all your reports permanently.");
    if (confirmDelete) {
      try {
        // Delete all incidents reported by user (optional, but requested by prompt text)
        const docsToDelete = [];
        snap.forEach(d => docsToDelete.push(deleteDoc(doc(db, 'incidents', d.id))));
        await Promise.all(docsToDelete);

        // Delete user doc
        await deleteDoc(userDocRef);

        // Delete auth account
        await deleteUser(user);
        
        sessionStorage.removeItem('userProfile');
        window.location.href = 'index.html';
      } catch (err) {
        console.error("Error deleting account:", err);
        // It might fail if the user's login session is too old. They need to reauthenticate.
        if (err.code === 'auth/requires-recent-login') {
          alert('For security reasons, you must log out and log back in before deleting your account.');
        } else {
          showToast('Failed to delete account.', true);
        }
      }
    }
  });
});
