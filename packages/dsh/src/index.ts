/** The public DSH plugin entry; internal workspace modules are bundled at release time. */
export {
  FlowboardService,
  FlowboardHttpClient,
  FlowboardRemoteError,
  MeetingCoordinator,
  default,
} from '@flowboard/dsh-service'
export type { Config, HttpClientConfig } from '@flowboard/dsh-service'
