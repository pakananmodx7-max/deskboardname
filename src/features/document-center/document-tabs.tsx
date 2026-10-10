import { useRef } from 'react'

import { cn } from '@/lib/utils'

import { DOCUMENT_TABS, type DocumentTab } from './document-center-model'
import { nextTabIndex } from './document-center-ui'

export interface DocumentTabsProps {
  active: DocumentTab
  onChange: (tab: DocumentTab) => void
  /** Optional count shown next to a tab (real counts only). */
  counts?: Partial<Record<DocumentTab, number | null>>
  panelId: string
}

/** Rounded tab bar (ทั้งหมด / เอกสารของฉัน / แชร์กับฉัน / ใน Google Drive /
 * รายการโปรด) with arrow-key navigation. */
export function DocumentTabs({ active, onChange, counts, panelId }: DocumentTabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div role="tablist" aria-label="ประเภทรายการเอกสาร" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {DOCUMENT_TABS.map((tab, index) => {
        const selected = tab.key === active
        const count = counts?.[tab.key]
        return (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="tab"
            id={`document-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => {
              const next = nextTabIndex(index, e.key, DOCUMENT_TABS.length)
              if (next === null) return
              e.preventDefault()
              onChange(DOCUMENT_TABS[next].key)
              refs.current[next]?.focus()
            }}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              selected ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {tab.label}
            {typeof count === 'number' && <span className={cn('ml-1.5 text-xs tabular-nums', selected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
