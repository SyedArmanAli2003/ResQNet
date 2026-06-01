import { MongoClient } from 'mongodb'

const DB_NAME = 'resqnet'

let mongoClient = null
let connecting = null

/**
 * Lazily connect to MongoDB Atlas and reuse a single pooled client.
 * Throws if MONGODB_URI is not configured.
 */
async function getMongoClient() {
  if (mongoClient) return mongoClient

  // Collapse concurrent first-time callers onto one connect() promise.
  if (!connecting) {
    const uri = process.env.MONGODB_URI
    if (!uri || uri === 'your-mongodb-atlas-uri') {
      throw new Error('MONGODB_URI is not configured in server/.env')
    }
    const client = new MongoClient(uri)
    connecting = client
      .connect()
      .then(() => {
        mongoClient = client
        console.log('[MongoDB] Connected to Atlas')
        return client
      })
      .finally(() => {
        connecting = null
      })
  }

  return connecting
}

function getDb() {
  if (!mongoClient) throw new Error('MongoDB client not connected yet')
  return mongoClient.db(DB_NAME)
}

/**
 * Mirror an incident written to Firestore into MongoDB so the agent's
 * search tools can query it. Upsert keyed on the Firestore doc id.
 */
async function syncIncidentToMongo(incident) {
  await getMongoClient()
  const { id, ...rest } = incident
  await getDb()
    .collection('incidents')
    .updateOne(
      { _id: id },
      { $set: { ...rest, _id: id, syncedAt: new Date() } },
      { upsert: true }
    )
  console.log('[MongoDB] Incident synced:', id)
}

export { getMongoClient, getDb, syncIncidentToMongo, DB_NAME }
