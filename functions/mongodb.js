'use strict'

const { MongoClient } = require('mongodb')

const DB_NAME = 'resqnet'
let _client = null
let _connecting = null

/**
 * Lazily connect and reuse one pooled client across warm function instances.
 * Throws a clear error when MONGODB_URI is not configured so callers can
 * degrade gracefully rather than hanging or emitting a cryptic socket error.
 */
async function getMongoClient() {
  if (_client) return _client

  if (!_connecting) {
    const uri = process.env.MONGODB_URI
    if (!uri || uri === 'your-mongodb-atlas-uri') {
      throw new Error('MONGODB_URI is not configured')
    }
    const c = new MongoClient(uri)
    _connecting = c.connect().then(() => {
      _client = c
      console.log('[MongoDB] Connected to Atlas')
      return c
    }).finally(() => { _connecting = null })
  }

  return _connecting
}

function db() {
  if (!_client) throw new Error('MongoDB not connected yet')
  return _client.db(DB_NAME)
}

/** Upsert an incident into MongoDB so agent searches find it. */
async function syncIncident(incident) {
  const { id, ...rest } = incident
  await getMongoClient()
  await db().collection('incidents').updateOne(
    { _id: id },
    { $set: { ...rest, _id: id, syncedAt: new Date() } },
    { upsert: true }
  )
}

/** Search resolved past incidents similar to the incoming one. */
async function searchIncidents({ location = '', type }) {
  await getMongoClient()
  const escaped = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const results = await db().collection('incidents')
    .find({
      type,
      location: { $regex: escaped, $options: 'i' },
      status: 'resolved',
    })
    .sort({ timestamp: -1 })
    .limit(5)
    .toArray()
  return results.map((r) => ({
    type: r.type,
    location: r.location,
    triageLevel: r.triageLevel,
    resolutionTime: r.estimatedMinutes,
  }))
}

/** Find available volunteers whose skill matches any of the requested types. */
async function findVolunteers({ skillTypes = [], limit = 5 }) {
  await getMongoClient()
  const col = db().collection('volunteers')
  const filters = skillTypes
    .filter(Boolean)
    .map((s) => ({ skill: { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }))

  const q = { available: true }
  if (filters.length) q.$or = filters

  let matches = await col.find(q).limit(limit).toArray()
  if (matches.length === 0 && filters.length) {
    matches = await col.find({ available: true }).limit(limit).toArray()
  }
  return matches
}

/** Append a row to agent_decisions for observability / audit. */
async function saveAgentDecision(doc) {
  await getMongoClient()
  await db().collection('agent_decisions').insertOne(doc)
}

module.exports = { getMongoClient, syncIncident, searchIncidents, findVolunteers, saveAgentDecision }
