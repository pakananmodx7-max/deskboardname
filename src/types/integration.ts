export type IntegrationConnectionState = 'not_configured' | 'not_connected' | 'connected'

export interface IntegrationStatusItem {
  id: string
  name: string
  state: IntegrationConnectionState
}
