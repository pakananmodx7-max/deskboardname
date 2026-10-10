import { dataMode } from '@/lib/data-mode'

import { useMissingReportDataDemo, useMissingReportDataReal, type MissingReportData } from './use-missing-report-data'

/** Real (Supabase) or Demo data for the report — decided once per app
 * load (dataMode is constant), so the hook order never changes. */
export const useMissingReportData: () => MissingReportData = dataMode === 'supabase' ? useMissingReportDataReal : useMissingReportDataDemo
