import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { projectConfig, projects } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })

  // Verify user owns the project
  const [project] = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Get config (may not exist — return null)
  const [config] = await getDb()
    .select()
    .from(projectConfig)
    .where(eq(projectConfig.projectId, projectId))

  return NextResponse.json({
    config: config
      ? {
          supervisorPrompt: config.supervisorPrompt,
          agentPrompts: config.agentPrompts,
          activeTools: config.activeTools,
          toolParams: config.toolParams,
          updatedAt: config.updatedAt,
        }
      : null,
  })
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    projectId: string
    supervisorPrompt?: string | null
    agentPrompts?: Record<string, string> | null
    activeTools?: string[] | null
    toolParams?: Record<string, Record<string, unknown>> | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.projectId) {
    return NextResponse.json({ error: 'Missing projectId' }, { status: 400 })
  }

  // Verify user owns the project
  const [project] = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, body.projectId), eq(projects.userId, userId)))
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Upsert config
  const values = {
    projectId: body.projectId,
    supervisorPrompt: body.supervisorPrompt ?? null,
    agentPrompts: body.agentPrompts ?? null,
    activeTools: body.activeTools ?? null,
    toolParams: body.toolParams ?? null,
    updatedAt: new Date(),
  }

  await getDb()
    .insert(projectConfig)
    .values(values)
    .onConflictDoUpdate({
      target: projectConfig.projectId,
      set: {
        supervisorPrompt: values.supervisorPrompt,
        agentPrompts: values.agentPrompts,
        activeTools: values.activeTools,
        toolParams: values.toolParams,
        updatedAt: values.updatedAt,
      },
    })

  return NextResponse.json({ ok: true })
}
