const admin = require('firebase-admin');
const config = require('../config');

let db;

function initFirebase() {
  if (admin.apps.length === 0) {
    admin.initializeApp({
      projectId: config.firebase.projectId,
    });
    console.log('[Firebase] Admin SDK initialized');
  }
  db = admin.firestore();
  return db;
}

function getDb() {
  if (!db) {
    return initFirebase();
  }
  return db;
}

module.exports = { initFirebase, getDb, admin };
