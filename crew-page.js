import { db } from './firebaseConfig.js'
import { collection, addDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'

console.log('[Volunteers] crew-page.js loaded')

let unsubscribeVolunteers = null

async function ensureVolunteerSession() {
  const auth = getAuth()
  if (auth.currentUser) return

  try {
    await signInAnonymously(auth)
    console.log('[Volunteers] Anonymous auth established')
  } catch (err) {
    console.error('[Volunteers] Anonymous auth failed:', err.code, err.message)
    throw err
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Volunteers] Page loaded')

  try {
    await ensureVolunteerSession()
  } catch (err) {
    const listEl = document.getElementById('volunteersList')
    if (listEl) {
      listEl.innerHTML = '<p style="color:#F09595;padding:16px">Unable to connect to volunteer service. Check Firebase Auth settings (enable Anonymous sign-in) and refresh.</p>'
    }
    return
  }

  loadVolunteers('all')

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const locField = document.getElementById('location')
        if (locField) {
          locField.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
          fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
            { headers: { 'Accept-Language': 'en' } })
            .then(r => r.json())
            .then(d => {
              if (d.display_name && locField) locField.value = d.display_name
            })
            .catch(() => {})
        }
      },
      () => {
        const locField = document.getElementById('location')
        if (locField) locField.placeholder = 'Enter your location manually'
      }
    )
  }

  const registerBtn = document.getElementById('registerBtn')
  if (!registerBtn) {
    console.error('[Volunteers] registerBtn not found!')
    return
  }

  registerBtn.addEventListener('click', async () => {
    const name = document.getElementById('volName')?.value?.trim()
    const phone = document.getElementById('volPhone')?.value?.trim()
    const skill = document.getElementById('volSkill')?.value
    const location = document.getElementById('location')?.value?.trim()
    const available = document.getElementById('volAvailable')?.checked ?? true

    if (!name || !phone || !skill) {
      alert('Please fill in name, phone and skill')
      return
    }

    registerBtn.textContent = 'Registering...'
    registerBtn.disabled = true

    try {
      await ensureVolunteerSession()

      await addDoc(collection(db, 'volunteers'), {
        name,
        phone,
        skill,
        location: location || 'Location not provided',
        available,
        registeredAt: serverTimestamp()
      })

      registerBtn.textContent = 'Registered!'
      registerBtn.style.background = '#0F6E56'

      document.getElementById('volName').value = ''
      document.getElementById('volPhone').value = ''

      setTimeout(() => {
        registerBtn.textContent = 'Register'
        registerBtn.style.background = ''
        registerBtn.disabled = false
      }, 2000)
    } catch (err) {
      console.error('[Volunteers] Error:', err.code, err.message)
      alert('Registration failed: ' + err.message)
      registerBtn.textContent = 'Register'
      registerBtn.disabled = false
    }
  })

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      loadVolunteers(btn.dataset.filter || 'all')
    })
  })
})

function loadVolunteers(filter) {
  const listEl = document.getElementById('volunteersList')
  if (!listEl) return

  listEl.innerHTML = '<p style="color:#555">Loading...</p>'

  if (unsubscribeVolunteers) unsubscribeVolunteers()

  unsubscribeVolunteers = onSnapshot(collection(db, 'volunteers'), (snapshot) => {
    let docs = snapshot.docs

    docs = docs.sort((a, b) => {
      const aData = a.data() || {}
      const bData = b.data() || {}
      const aTs = aData.registeredAt || aData.timestamp
      const bTs = bData.registeredAt || bData.timestamp
      const aMs = aTs?.toMillis?.() || 0
      const bMs = bTs?.toMillis?.() || 0
      return bMs - aMs
    })

    if (filter !== 'all') {
      docs = docs.filter(d => d.data().skill?.toLowerCase().includes(filter.toLowerCase()))
    }

    if (docs.length === 0) {
      listEl.innerHTML = '<p style="color:#555;padding:16px">No volunteers registered yet</p>'
      return
    }

    listEl.innerHTML = docs.map(doc => {
      const v = doc.data()
      const initials = v.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
      return `
        <div style="background:#13161f;border:1px solid #2a2d3a;border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <div style="width:36px;height:36px;border-radius:50%;background:#A32D2D;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#FCEBEB;flex-shrink:0">${initials}</div>
          <div style="flex:1">
            <div style="font-size:12px;font-weight:500;color:#d0d0d0">${v.name || 'Unknown'}</div>
            <div style="font-size:10px;color:#555">${v.skill || 'No skill'} · ${v.location || 'No location'}</div>
          </div>
          <div style="display:flex;align-items:center;gap:4px">
            <div style="width:6px;height:6px;border-radius:50%;background:${v.available ? '#3B6D11' : '#854F0B'}"></div>
            <span style="font-size:10px;color:${v.available ? '#9FE1CB' : '#FAC775'}">${v.available ? 'Available' : 'Busy'}</span>
          </div>
        </div>`
    }).join('')
  }, (err) => {
    console.error('[Volunteers] onSnapshot error:', err.code, err.message)
    listEl.innerHTML = '<p style="color:#F09595">Error loading volunteers: ' + err.message + '</p>'
  })
}
