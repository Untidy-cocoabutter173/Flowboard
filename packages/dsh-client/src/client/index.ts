import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import flowboardRemote from '@flowboard/dsh-service/remote'
import { FlowboardController } from './controller.ts'
import { FlowboardView, type FlowboardInjected } from './FlowboardView.tsx'
import { FlowboardRemoteClient, type FlowboardRemotePort } from './remote.ts'

export const inject = ['remote', 'slots']

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(flowboardRemote)
  const controller = new FlowboardController(new FlowboardRemoteClient(ctx.remote.flowboard as FlowboardRemotePort))
  controller.start()
  const disposeSlot = ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'flowboard', order: 20, label: 'Flowboard',
    inject: (): FlowboardInjected => ({
      hooks: { flowboard: controller }, selectProject: controller.selectProject, selectSection: controller.selectSection,
      refresh: () => controller.refresh(),
      command: value => controller.command(value), upload: (meetingId, blob) => controller.uploadMeetingAudio(meetingId, blob),
    }),
  }, FlowboardView))
  return async () => {
    disposeSlot()
    controller.dispose()
    await disposeRemote()
  }
}
