import { ChevronDown, ChevronRight, ExternalLink, FileText, Link2, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { toFriendlyErrorMessage } from '@/lib/errors'
import { getAssignmentResources, getResourceSignedUrl } from '@/services/assignment-resource-service'
import type { AssignmentResource } from '@/types/assignment-resource'

interface AssignmentResourcesDisclosureProps {
  assignmentId: string
  /**
   * A pre-fetched resource count for this assignment (from
   * getResourceCounts, batched once per list), used only to decide
   * whether to render the toggle at all — avoids eagerly fetching every
   * visible assignment's full resource list. When omitted, the toggle is
   * always shown and simply reveals "ยังไม่มีสื่อหรือใบงาน" on expand if
   * there turn out to be none.
   */
  resourceCount?: number
}

/**
 * "ใบงานและลิงก์" — read-only, student-facing. Resources are fetched
 * lazily on first expand (never eagerly for every row in a list, to avoid
 * N+1). A file resource is never linked to its raw storage path directly
 * — opening one always goes through getResourceSignedUrl() first, a
 * short-lived signed URL requested only at the moment the student clicks
 * "เปิดใบงาน", gated by the exact same RLS this student's read access
 * already relies on everywhere else in the portal. A link resource opens
 * its own stored https:// URL directly in a new tab.
 */
export function AssignmentResourcesDisclosure({ assignmentId, resourceCount }: AssignmentResourcesDisclosureProps) {
  const [expanded, setExpanded] = useState(false)
  const [resources, setResources] = useState<AssignmentResource[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)

  if (resourceCount === 0) return null

  function toggle() {
    const next = !expanded
    setExpanded(next)
    if (next && resources === null && !loading) {
      setLoading(true)
      setError(null)
      getAssignmentResources(assignmentId)
        .then(setResources)
        .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
        .finally(() => setLoading(false))
    }
  }

  async function handleOpenFile(resource: AssignmentResource) {
    if (!resource.filePath) return
    setOpeningId(resource.id)
    setError(null)
    try {
      const signedUrl = await getResourceSignedUrl(resource.filePath)
      window.open(signedUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถเปิดไฟล์ได้'))
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <div className="mt-2 border-t pt-2">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        ใบงานและลิงก์
        {resourceCount !== undefined && resourceCount > 0 && (
          <span className="text-muted-foreground">({resourceCount})</span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {loading && <p className="text-xs text-muted-foreground">กำลังโหลด...</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {!loading && resources !== null && resources.length === 0 && (
            <p className="text-xs text-muted-foreground">ยังไม่มีสื่อหรือใบงานสำหรับงานนี้</p>
          )}
          {resources?.map((resource) => (
            <div key={resource.id} className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
              {resource.resourceType === 'file' ? (
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium">{resource.title}</span>
              {resource.resourceType === 'file' ? (
                <button
                  type="button"
                  onClick={() => handleOpenFile(resource)}
                  disabled={openingId === resource.id}
                  className="flex shrink-0 items-center gap-1 font-medium text-primary hover:underline disabled:opacity-50"
                >
                  {openingId === resource.id ? <Loader2 className="size-3 animate-spin" /> : <ExternalLink className="size-3" />}
                  เปิดใบงาน
                </button>
              ) : (
                <a
                  href={resource.url ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
                >
                  <ExternalLink className="size-3" />
                  เปิดงานออนไลน์
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
