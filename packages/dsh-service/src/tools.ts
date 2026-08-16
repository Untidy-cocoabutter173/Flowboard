import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CommandRequest } from '@flowboard/contracts'
import type { FlowboardService } from './index.ts'

const jsonOutput = {
  schema: { type: 'object' as const, additionalProperties: true, properties: {} },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

export function registerFlowboardTools(ctx: Context, service: FlowboardService): void {
  ctx.tools.register(defineTool({
    name: 'flowboard_snapshot',
    description: 'Read the authorized Flowboard workspace, optionally limited to one project.',
    parameters: { project_id: { type: 'string', description: 'Optional project id.' } },
    output: jsonOutput,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => JSON.parse(await service.remoteSnapshot(
      JSON.stringify(args.project_id === undefined ? {} : { projectId: args.project_id }), exec.signal,
    )) as object,
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_command',
    description: 'Execute any Flowboard command. Use a command type from the Flowboard contract and provide its payload; updates and deletes require expected_version.',
    parameters: {
      type: { type: 'string', required: true, description: 'Command type, for example task.create, meeting.summary.set, or event.update.' },
      payload: { type: 'object', required: true, additionalProperties: true, properties: {} },
      expected_version: { type: 'integer', description: 'Current entity version for update/delete commands.' },
    },
    output: jsonOutput,
    execute: async (args, exec) => JSON.parse(await service.remoteCommand(JSON.stringify({
      idempotencyKey: randomUUID(),
      type: args.type,
      payload: args.payload,
      ...(args.expected_version === undefined ? {} : { expectedVersion: args.expected_version }),
    } as CommandRequest), exec.signal)) as object,
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_create_task',
    description: 'Create a task in an authorized Flowboard project.',
    parameters: {
      project_id: { type: 'string', required: true }, title: { type: 'string', required: true },
      summary: { type: 'string' }, assignee_id: { type: 'string' }, due_at: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    },
    output: jsonOutput,
    execute: async (args, exec) => JSON.parse(await service.remoteCommand(JSON.stringify({
      idempotencyKey: randomUUID(), type: 'task.create',
      payload: {
        projectId: args.project_id, title: args.title,
        ...(args.summary === undefined ? {} : { summary: args.summary }),
        ...(args.assignee_id === undefined ? {} : { assigneeId: args.assignee_id }),
        ...(args.due_at === undefined ? {} : { dueAt: args.due_at }),
        ...(args.priority === undefined ? {} : { priority: args.priority }),
      },
    }), exec.signal)) as object,
  }))

  ctx.tools.register(defineTool({
    name: 'flowboard_update_task',
    description: 'Update a task using optimistic concurrency.',
    parameters: {
      id: { type: 'string', required: true }, expected_version: { type: 'integer', required: true },
      title: { type: 'string' }, summary: { type: 'string' }, column_id: { type: 'string' },
      assignee_id: { type: 'string' }, progress: { type: 'number' },
    },
    output: jsonOutput,
    execute: async (args, exec) => JSON.parse(await service.remoteCommand(JSON.stringify({
      idempotencyKey: randomUUID(), type: 'task.update', expectedVersion: args.expected_version,
      payload: {
        id: args.id,
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.summary === undefined ? {} : { summary: args.summary }),
        ...(args.column_id === undefined ? {} : { columnId: args.column_id }),
        ...(args.assignee_id === undefined ? {} : { assigneeId: args.assignee_id }),
        ...(args.progress === undefined ? {} : { progress: args.progress }),
      },
    }), exec.signal)) as object,
  }))
}
