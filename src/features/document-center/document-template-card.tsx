import { cn } from '@/lib/utils'

import { ACCENT, TEMPLATE_ICON } from './document-center-ui'
import type { DocumentTemplate, TemplatePreview } from './document-templates'

function Line({ w, strong = false }: { w: string; strong?: boolean }) {
  return <span className={cn('block h-[3px] rounded-full', strong ? 'bg-foreground/45' : 'bg-muted-foreground/25')} style={{ width: w }} />
}

/** Small, purely decorative "paper" sketch of the template layout. */
export function TemplatePreviewArt({ preview }: { preview: TemplatePreview }) {
  return (
    <div className="h-[72px] w-[92px] shrink-0 overflow-hidden rounded-md border border-border bg-background p-2 shadow-sm" aria-hidden="true">
      {preview === 'official' && (
        <div className="flex flex-col items-center gap-1">
          <span className="size-3.5 rounded-full border-2 border-foreground/40" />
          <Line w="70%" strong />
          <Line w="90%" />
          <Line w="85%" />
          <Line w="60%" />
          <Line w="80%" />
        </div>
      )}
      {preview === 'memo' && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="size-3 rounded-full border-2 border-foreground/40" />
            <Line w="55%" strong />
          </div>
          <Line w="80%" />
          <Line w="65%" />
          <Line w="90%" />
          <Line w="70%" />
          <Line w="40%" />
        </div>
      )}
      {preview === 'form' && (
        <div className="flex flex-col gap-1">
          <Line w="60%" strong />
          <Line w="85%" />
          <div className="mt-0.5 grid grid-cols-3 gap-[2px]">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="h-[6px] rounded-[1px] bg-muted-foreground/15" />
            ))}
          </div>
          <Line w="70%" />
        </div>
      )}
      {preview === 'table' && (
        <div className="flex flex-col gap-1">
          <Line w="55%" strong />
          <div className="grid grid-cols-4 gap-[2px]">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={`h${i}`} className="h-[6px] rounded-[1px] bg-foreground/25" />
            ))}
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} className="h-[6px] rounded-[1px] bg-muted-foreground/15" />
            ))}
          </div>
        </div>
      )}
      {preview === 'list' && (
        <div className="flex flex-col gap-[3px]">
          <Line w="60%" strong />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="h-[3px] w-[6px] rounded-full bg-foreground/30" />
              <Line w={`${70 - (i % 3) * 12}%`} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export interface DocumentTemplateCardProps {
  template: DocumentTemplate
  onCreate: (template: DocumentTemplate) => void
}

/** A template card. "สร้างเอกสาร" only opens the Phase 2 notice — it never
 * creates or saves anything. */
export function DocumentTemplateCard({ template, onCreate }: DocumentTemplateCardProps) {
  const Icon = TEMPLATE_ICON[template.icon]
  const accent = ACCENT[template.accent]
  return (
    <article className="flex h-full flex-col rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md" aria-labelledby={`template-${template.id}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-full', accent.soft, accent.text)} aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <TemplatePreviewArt preview={template.preview} />
      </div>
      <h3 id={`template-${template.id}`} className="mt-3 text-sm font-semibold leading-snug text-foreground">
        {template.titleChunks.map((chunk, i) => (
          <span key={i} className="inline-block">
            {chunk}
          </span>
        ))}
      </h3>
      <p className="mt-1 line-clamp-2 flex-1 text-xs leading-relaxed text-muted-foreground">{template.description}</p>
      <button
        type="button"
        onClick={() => onCreate(template)}
        className="mt-3 h-9 w-full rounded-xl border border-border bg-card text-sm font-medium text-primary transition-colors hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-describedby={`template-${template.id}-note`}
      >
        สร้างเอกสาร
      </button>
      <span id={`template-${template.id}-note`} className="sr-only">
        ฟีเจอร์นี้กำลังพัฒนา จะเปิดให้ใช้ในเฟส 2
      </span>
    </article>
  )
}
