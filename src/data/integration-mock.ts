import type { IntegrationStatusItem } from '@/types/dashboard'

export const mockIntegrationStatus: IntegrationStatusItem[] = [
  { id: 'supabase', name: 'Supabase', state: 'not_configured' },
  { id: 'google-sheets', name: 'Google Sheets', state: 'not_connected' },
  { id: 'line', name: 'LINE', state: 'not_connected' },
  { id: 'hermes', name: 'Hermes Agent', state: 'not_connected' },
]
