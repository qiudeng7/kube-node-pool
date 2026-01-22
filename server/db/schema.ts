import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  secretId: text('secret_id').notNull(),
  secretKey: text('secret_key').notNull(),
})

export const clusters = sqliteTable('clusters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  desiredNodeCount: integer('desired_node_count').notNull().default(0),
  actualNodeCount: integer('actual_node_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

export const nodes = sqliteTable('nodes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  ip: text('ip').notNull(),
  clusterId: integer('cluster_id').notNull().references(() => clusters.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['control-plane', 'worker'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

export const pollingRecords = sqliteTable('polling_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nodeId: integer('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  queriedAt: integer('queried_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  result: text('result').notNull(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Cluster = typeof clusters.$inferSelect
export type NewCluster = typeof clusters.$inferInsert
export type Node = typeof nodes.$inferSelect
export type NewNode = typeof nodes.$inferInsert
export type PollingRecord = typeof pollingRecords.$inferSelect
export type NewPollingRecord = typeof pollingRecords.$inferInsert
