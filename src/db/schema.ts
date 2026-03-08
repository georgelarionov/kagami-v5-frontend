import { pgTable, text, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core'

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const chats = pgTable('chats', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  title: text('title'),
  pendingMessage: text('pending_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const projectConfig = pgTable('project_config', {
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id)
    .primaryKey(),
  supervisorPrompt: text('supervisor_prompt'),
  agentPrompts: jsonb('agent_prompts').$type<Record<string, string>>(),
  activeTools: jsonb('active_tools').$type<string[]>(),
  toolParams: jsonb('tool_params').$type<Record<string, Record<string, unknown>>>(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
