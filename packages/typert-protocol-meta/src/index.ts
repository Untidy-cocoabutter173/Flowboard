/** Standalone-workspace compiler adapter; every runtime operation delegates to the published protocol. */
import type { Context } from '@deepseek-ai/cordis'
import * as runtime from '@deepseek-ai/dsh-typert-protocol-runtime'

export type * from '@deepseek-ai/dsh-typert-protocol-runtime'
export type {
  RemoteFailure,
  RemoteResult,
  TypertClientRemote,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol-runtime'

export interface TypertLookup<Host, Wire> {
  readonly __host?: Host
  readonly __wire?: Wire
}
export interface TypertContext<Wire> {
  readonly __wire?: Wire
}
export interface TypertLookupMap {}
export interface TypertContextMap {}

type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
) => void

export abstract class TypertRemoteService<T = never> extends runtime.TypertRemoteService<T> {
  protected constructor(ctx: Context | undefined, serviceKey: string) {
    super(ctx as Context, serviceKey)
  }
}

export function Remote<This extends object, Args extends unknown[], Result>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void
export function Remote(exportName: string): RemoteMethodDecorator
export function Remote(first: string | ((...args: never[]) => unknown), second?: ClassMethodDecoratorContext): void | RemoteMethodDecorator {
  if (typeof first === 'string') return runtime.Remote(first)
  const decorate = runtime.Remote as unknown as (method: Function, context: ClassMethodDecoratorContext) => void
  return decorate(first, second as ClassMethodDecoratorContext)
}
