import {
  BarChart3,
  ClipboardList,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Link2,
  NotebookPen,
  Presentation,
  ScrollText,
  Users,
  type LucideIcon,
} from 'lucide-react'

import { DEFAULT_DOCUMENT_FILTERS, type DocumentFilters, type DocumentKind, type DocumentTab, type DocumentView } from './document-center-model'
import type { DocumentTemplate, TemplateAccent, TemplateIcon } from './document-templates'

// ==================================================
// Visual tokens (mid-tone tints — readable in light and dark themes)
// ==================================================

export const ACCENT: Record<TemplateAccent, { soft: string; text: string; ring: string }> = {
  blue: { soft: 'bg-primary/12', text: 'text-primary', ring: 'ring-primary/25' },
  purple: { soft: 'bg-violet-500/15', text: 'text-violet-600', ring: 'ring-violet-500/25' },
  green: { soft: 'bg-emerald-500/15', text: 'text-emerald-600', ring: 'ring-emerald-500/25' },
  orange: { soft: 'bg-orange-500/15', text: 'text-orange-600', ring: 'ring-orange-500/25' },
  red: { soft: 'bg-rose-500/15', text: 'text-rose-600', ring: 'ring-rose-500/25' },
}

export const TEMPLATE_ICON: Record<TemplateIcon, LucideIcon> = {
  plan: FileText,
  homeroom: Users,
  memo: ClipboardList,
  report: BarChart3,
  roster: ScrollText,
}

export const KIND_STYLE: Record<DocumentKind, { icon: LucideIcon; tile: string; badge: string; short: string }> = {
  word: { icon: FileText, tile: 'bg-blue-600 text-white', badge: 'bg-primary/12 text-primary', short: 'W' },
  pdf: { icon: FileText, tile: 'bg-rose-600 text-white', badge: 'bg-rose-500/15 text-rose-600', short: 'PDF' },
  excel: { icon: FileSpreadsheet, tile: 'bg-emerald-600 text-white', badge: 'bg-emerald-500/15 text-emerald-600', short: 'X' },
  powerpoint: { icon: Presentation, tile: 'bg-orange-600 text-white', badge: 'bg-orange-500/15 text-orange-600', short: 'P' },
  image: { icon: FileImage, tile: 'bg-sky-600 text-white', badge: 'bg-sky-500/15 text-sky-600', short: 'IMG' },
  video: { icon: FileVideo, tile: 'bg-violet-600 text-white', badge: 'bg-violet-500/15 text-violet-600', short: 'VID' },
  google_doc: { icon: FileText, tile: 'bg-blue-500 text-white', badge: 'bg-primary/12 text-primary', short: 'Doc' },
  google_sheet: { icon: FileSpreadsheet, tile: 'bg-green-600 text-white', badge: 'bg-emerald-500/15 text-emerald-600', short: 'Sh' },
  google_slide: { icon: Presentation, tile: 'bg-amber-500 text-white', badge: 'bg-orange-500/15 text-orange-600', short: 'Sl' },
  drive_file: { icon: File, tile: 'bg-slate-600 text-white', badge: 'bg-muted text-muted-foreground', short: 'GD' },
  link: { icon: Link2, tile: 'bg-slate-500 text-white', badge: 'bg-muted text-muted-foreground', short: '' },
  other: { icon: File, tile: 'bg-slate-500 text-white', badge: 'bg-muted text-muted-foreground', short: '' },
}

export const PHASE2_ICON = NotebookPen

// ==================================================
// Page UI state (pure reducer — testable without a DOM)
// ==================================================

export interface DocumentCenterUiState {
  filters: DocumentFilters
  view: DocumentView
  selected: ReadonlySet<string>
  /** "เอกสารล่าสุด" shows the first rows until expanded. */
  showAll: boolean
}

export const RECENT_LIMIT = 10

export const INITIAL_UI_STATE: DocumentCenterUiState = {
  filters: DEFAULT_DOCUMENT_FILTERS,
  view: 'list',
  selected: new Set(),
  showAll: false,
}

export type DocumentCenterUiAction =
  | { type: 'tab'; tab: DocumentTab }
  | { type: 'filters'; patch: Partial<Omit<DocumentFilters, 'tab'>> }
  | { type: 'clearFilters' }
  | { type: 'view'; view: DocumentView }
  | { type: 'toggleSelect'; id: string }
  | { type: 'selectAll'; ids: string[] }
  | { type: 'clearSelection' }
  | { type: 'showAll'; value: boolean }

export function documentCenterUiReducer(state: DocumentCenterUiState, action: DocumentCenterUiAction): DocumentCenterUiState {
  switch (action.type) {
    case 'tab':
      return state.filters.tab === action.tab ? state : { ...state, filters: { ...state.filters, tab: action.tab }, selected: new Set(), showAll: false }
    case 'filters':
      return { ...state, filters: { ...state.filters, ...action.patch }, selected: new Set(), showAll: false }
    case 'clearFilters':
      return { ...state, filters: { ...DEFAULT_DOCUMENT_FILTERS, tab: state.filters.tab, sort: state.filters.sort }, selected: new Set() }
    case 'view':
      return state.view === action.view ? state : { ...state, view: action.view }
    case 'toggleSelect': {
      const next = new Set(state.selected)
      if (next.has(action.id)) next.delete(action.id)
      else next.add(action.id)
      return { ...state, selected: next }
    }
    case 'selectAll': {
      const allSelected = action.ids.length > 0 && action.ids.every((id) => state.selected.has(id))
      return { ...state, selected: allSelected ? new Set() : new Set(action.ids) }
    }
    case 'clearSelection':
      return { ...state, selected: new Set() }
    case 'showAll':
      return { ...state, showAll: action.value }
  }
}

/** Arrow / Home / End movement for the tab bar (roving focus). */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (key === 'ArrowRight') return (current + 1) % count
  if (key === 'ArrowLeft') return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

// ==================================================
// Google Drive connection (existing OAuth integration, read-only here)
// ==================================================

export type DriveConnection =
  | { status: 'loading' }
  | { status: 'connected'; email: string | null }
  | { status: 'disconnected' }
  | { status: 'error' }
  /** Demo Mode — Drive needs the real backend. */
  | { status: 'unsupported' }

export function driveStatusText(drive: DriveConnection): string {
  switch (drive.status) {
    case 'loading':
      return 'กำลังตรวจสอบการเชื่อมต่อ...'
    case 'connected':
      return 'เชื่อมต่อแล้ว'
    case 'disconnected':
      return 'ยังไม่ได้เชื่อมต่อ'
    case 'error':
      return 'ตรวจสอบการเชื่อมต่อไม่สำเร็จ'
    case 'unsupported':
      return 'ใช้ได้เมื่อเชื่อมต่อฐานข้อมูลจริง'
  }
}

// ==================================================
// Phase 2 notices
// ==================================================

/** What the info dialog explains — every "not yet" action on the page. */
export type DocumentInfoTopic =
  | { kind: 'template'; template: DocumentTemplate }
  | { kind: 'folder' }
  | { kind: 'upload' }
  | { kind: 'blank' }

export function infoTitle(topic: DocumentInfoTopic): string {
  switch (topic.kind) {
    case 'template':
      return `กำลังพัฒนา — ${topic.template.title}`
    case 'folder':
      return 'สร้างโฟลเดอร์'
    case 'upload':
      return 'อัปโหลดไฟล์'
    case 'blank':
      return 'กำลังพัฒนา — เอกสารเปล่า'
  }
}

