import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

const dbPath = process.env.DATABASE_PATH || './data.db'
const sqlite = new Database(dbPath)
const db = drizzle(sqlite, { schema })

console.log('Database initialized at:', dbPath)

// Manually create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    secret_id TEXT NOT NULL,
    secret_key TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    desired_node_count INTEGER NOT NULL DEFAULT 0,
    actual_node_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('control-plane', 'worker')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS polling_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    queried_at INTEGER NOT NULL,
    result TEXT NOT NULL
  );
`)

console.log('Database tables created successfully!')

sqlite.close()
