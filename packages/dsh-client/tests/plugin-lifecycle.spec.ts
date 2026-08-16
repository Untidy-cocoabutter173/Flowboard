import { beforeEach, describe, expect, it, vi } from 'vitest'

const lifecycle = vi.hoisted(() => ({
  controllerDispose: vi.fn(),
  controllerStart: vi.fn(),
  remotePort: undefined as unknown,
}))

vi.mock('../src/client/controller.ts', () => ({
  FlowboardController: class {
    constructor(remote: unknown) { lifecycle.remotePort = remote }
    dispose = lifecycle.controllerDispose
    start = lifecycle.controllerStart
  },
}))

vi.mock('../src/client/remote.ts', () => ({
  FlowboardRemoteClient: class {
    constructor(readonly port: unknown) {}
  },
}))

vi.mock('../src/client/FlowboardView.tsx', () => ({ FlowboardView: () => null, FlowboardMeetingDock: () => null }))
vi.mock('@flowboard/dsh-service/remote', () => ({ default: { package: '@flowboard/dsh-service', descriptors: [] } }))

import { apply } from '../src/client/index.ts'

describe('Flowboard 客户端生命周期', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lifecycle.remotePort = undefined
  })

  it('挂载 Remote 后在声明依赖的子 Context 中启动页面', async () => {
    const disposeRemote = vi.fn(async () => undefined)
    const disposeFeature = vi.fn(async () => undefined)
    const disposeSlot = vi.fn()
    const flowboard = { snapshot: vi.fn() }
    const slot = { inject: vi.fn(() => disposeSlot), register: vi.fn() }
    const effect = vi.fn()
    const feature = { await: vi.fn(async () => undefined), dispose: disposeFeature }
    const scope = {
      get: vi.fn((name: string) => name === 'remote.flowboard' ? flowboard : undefined),
      remote: Object.defineProperty({}, 'flowboard', {
        get: () => { throw new Error('不应通过嵌套 getter 读取动态 Remote') },
      }),
      slots: slot,
      effect,
    }
    const ctx = {
      remote: { $mount: vi.fn(async () => disposeRemote) },
      inject: vi.fn((deps: string[], callback: (scope: unknown) => void) => {
        expect(deps).toEqual(['remote.flowboard', 'slots'])
        callback(scope)
        return feature
      }),
    }

    const dispose = await apply(ctx as never)

    expect(ctx.remote.$mount).toHaveBeenCalledOnce()
    expect(lifecycle.controllerStart).toHaveBeenCalledOnce()
    expect(scope.get).toHaveBeenCalledWith('remote.flowboard')
    expect((lifecycle.remotePort as { port: unknown }).port).toBe(flowboard)
    expect(slot.inject).toHaveBeenCalledTimes(2)
    expect(slot.inject).toHaveBeenCalledWith('conversation.view', expect.any(Function))
    expect(slot.inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
    expect(effect).toHaveBeenCalledWith(expect.any(Function), 'flowboard-client: controller')

    await dispose()
    expect(disposeFeature).toHaveBeenCalledBefore(disposeRemote)
  })
})
