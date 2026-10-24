/** One independently-loaded dashboard dataset. */
export type Resource<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'success'; data: T }

export const LOADING: Resource<never> = { status: 'loading' }

export function success<T>(data: T): Resource<T> {
  return { status: 'success', data }
}

/** Combines resources: error if any failed, loading while any is pending
 * (never "empty" while a request is still running), success otherwise. */
export function combineResources<A, B>(a: Resource<A>, b: Resource<B>): Resource<[A, B]> {
  if (a.status === 'error') return a
  if (b.status === 'error') return b
  if (a.status === 'loading' || b.status === 'loading') return LOADING
  return { status: 'success', data: [a.data, b.data] }
}

export function formatPercent(value: number | null, digits = 0): string {
  return value === null || !Number.isFinite(value) ? '-' : `${value.toFixed(digits)}%`
}

export function formatCount(value: number): string {
  return value.toLocaleString('th-TH')
}

export interface SummaryCardValue {
  value: string | null
  hint: string | null
}

export function countValue(count: number, unit: string, hint: string | null): SummaryCardValue {
  return { value: `${formatCount(count)} ${unit}`, hint }
}
