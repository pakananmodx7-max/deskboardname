import { MoreVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export interface RowAction {
  key: string
  label: string
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
  /** Renders a divider directly above this action — for grouping a
   * destructive/unrelated action (e.g. "ลบงาน") apart from the rest of
   * the menu. */
  separatorBefore?: boolean
}

interface RowActionsMenuProps {
  actions: RowAction[]
  label?: string
}

/**
 * A minimal "..." row action menu, hand-built rather than pulling in
 * @radix-ui/react-dropdown-menu — this app only has @radix-ui/react-dialog
 * installed so far (used for Dialog/Sheet), and a single always-simple
 * click-to-toggle-plus-click-outside menu doesn't need a whole new
 * dependency. Matches this codebase's existing pattern of hand-building
 * small primitives (NativeSelect, Sheet-on-top-of-Dialog, etc.).
 */
export function RowActionsMenu({ actions, label = 'ตัวเลือก' }: RowActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="size-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map((action) => (
            <div key={action.key}>
              {action.separatorBefore && <div className="my-1 h-px bg-border" role="separator" />}
              <button
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false)
                  action.onSelect()
                }}
                className={cn(
                  'block w-full px-3 py-2 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
                  action.destructive ? 'text-destructive hover:bg-destructive/10' : 'text-foreground',
                )}
              >
                {action.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
