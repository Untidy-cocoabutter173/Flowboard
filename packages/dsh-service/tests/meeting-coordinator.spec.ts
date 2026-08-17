import { describe, expect, it, vi } from 'vitest'
import type { FlowboardSnapshot, MeetingAgentBindingView } from '@flowboard/contracts'
import { MeetingCoordinator } from '../src/meeting-coordinator.ts'

function snapshot(sequence: number): FlowboardSnapshot {
  return {
    apiVersion: 3, cursor: sequence,
    actor: { id: 'user-1', tenantId: 'tenant-1', name: '用户', email: null },
    teams: [], teamMembers: [], people: [], projects: [], projectMembers: [], workflowStatuses: [], fieldDefinitions: [], savedViews: [], categories: [], tasks: [], library: [], events: [], aiActions: [],
    meetings: [{ id: 'meeting-1', tenantId: 'tenant-1', teamId: 'team-1', title: '评审会', status: 'live', settings: { automation: 'execute', feedback: 'activity', answerQuestions: true, silenceSec: 3 }, transcript: '', summary: '', decisions: [], risks: [], startedAt: null, endedAt: null, version: 2, createdAt: '', updatedAt: '' }],
    utterances: sequence === 0 ? [] : [{ id: `utterance-${sequence}`, meetingId: 'meeting-1', sequence, speakerId: null, text: `第 ${sequence} 段`, startedAt: null, endedAt: null, createdAt: '' }],
    meetingAgentBindings: [{ meetingId: 'meeting-1', sessionId: 'session-1', state: 'active', deliveredSequence: 0, analyzedSequence: 0, createdAt: '', updatedAt: '' }],
    meetingIntents: [],
    links: { projectMeetings: [], projectLibrary: [], meetingLibrary: [], taskMeetings: [], taskLibrary: [] },
  }
}

describe('MeetingCoordinator', () => {
  it('新转录在空闲时唤醒 Supervisor，并推进已投递水位', async () => {
    const followup = vi.fn()
    const steer = vi.fn()
    const agent = { id: 'session-1', status: 'idle', inbox: { replace: vi.fn(() => false) }, ctx: { on: vi.fn(() => vi.fn()) }, followup, steer }
    const client = { snapshot: vi.fn(async () => snapshot(1)), command: vi.fn(async () => ({ cursor: 2, entityType: 'meeting_agent_binding', entityId: 'meeting-1', version: 1, replayed: false })) }
    const context = { effect: vi.fn((factory: () => unknown) => factory()), logger: { warn: vi.fn() } }
    const prompt = { context: vi.fn(() => vi.fn()) }
    const coordinator = new MeetingCoordinator(context as never, client as never, { get: () => agent } as never, prompt)
    const binding: MeetingAgentBindingView = { meetingId: 'meeting-1', sessionId: 'session-1', state: 'active', deliveredSequence: 0, analyzedSequence: 0, createdAt: '', updatedAt: '' }
    await (coordinator as unknown as { synchronize(value: MeetingAgentBindingView): Promise<void> }).synchronize(binding)
    expect(followup).toHaveBeenCalledOnce()
    expect(steer).not.toHaveBeenCalled()
    expect(client.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'meeting.agent.progress', payload: { id: 'meeting-1', deliveredSequence: 1 } }), expect.any(AbortSignal))
  })
})
