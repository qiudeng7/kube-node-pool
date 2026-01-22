import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

const dbPath = process.env.DATABASE_PATH || './data.db'

const sqlite = new Database(dbPath)

export const db = drizzle(sqlite, { schema })
