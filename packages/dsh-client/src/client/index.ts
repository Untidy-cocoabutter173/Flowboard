import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import flowboardRemote from '@flowboard/dsh-service/remote'
import { FlowboardController } from './controller.ts'
import { FlowboardMeetingDock, FlowboardView, type FlowboardInjected } from './FlowboardView.tsx'
import { FlowboardRemoteClient, type FlowboardRemotePort } from './remote.ts'

export const inject = ['remote', 'slots']

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(flowboardRemote)
  const feature = ctx.inject(['remote.flowboard', 'slots'], (scope: Context) => {
    const remote = scope.get('remote.flowboard') as FlowboardRemotePort | undefined
    if (remote === undefined) throw new Error('Flowboard Remote 未挂载')
    const controller = new FlowboardController(new FlowboardRemoteClient(remote))
    controller.start()
    scope.effect(() => () => controller.dispose(), 'flowboard-client: controller')
    const inject = (): FlowboardInjected => ({
      hooks: { flowboard: controller },
      getState: controller.getSnapshot,
      navigate: controller.navigate,
      refresh: () => controller.refresh(),
      command: value => controller.command(value),
      upload: (meetingId, blob, clientSegmentId, startedAt, endedAt) => controller.uploadMeetingAudio(meetingId, blob, clientSegmentId, startedAt, endedAt),
      setMeetingRuntime: controller.setMeetingRuntime,
    })
    scope.slots.inject('conversation.view', () => scope.slots.register({
      name: 'conversation.view', id: 'flowboard', order: 20, label: 'Flowboard',
      inject,
    }, FlowboardView))
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock', id: 'flowboard-meeting', order: 30, label: 'Flowboard 会议', inject,
    }, FlowboardMeetingDock))
  })

  try {
    await feature.await()
  } catch (error) {
    await disposeRemote()
    throw error
  }

  return async () => {
    await feature.dispose()
    await disposeRemote()
  }
}
