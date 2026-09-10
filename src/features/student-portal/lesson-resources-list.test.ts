import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./lesson-resources-list.tsx', import.meta.url), 'utf-8')
}

describe('LessonResourcesList — student-facing resource buttons match exact spec labels (Section 6/7)', () => {
  const source = readSource()

  it('labels every open action per resource type: [เปิดสไลด์] / [ดูวิดีโอ] / [เปิดเอกสาร] / [เปิดลิงก์]', () => {
    expect(source).toContain("slide: 'เปิดสไลด์'")
    expect(source).toContain("video: 'ดูวิดีโอ'")
    expect(source).toContain("document: 'เปิดเอกสาร'")
    expect(source).toContain("link: 'เปิดลิงก์'")
  })

  it('a file resource is never opened via a raw storage path — always through a short-lived signed URL first', () => {
    expect(source).toContain('getLessonResourceSignedUrl(resource.filePath)')
    expect(source).not.toMatch(/href=\{resource\.filePath/)
  })

  it('prefers an inline YouTube preview when safe, otherwise falls back to a plain open-in-new-tab link — never a download/proxy', () => {
    expect(source).toContain('getYoutubeEmbedUrl(resource.url)')
    expect(source).toContain('<iframe')
    expect(source).not.toMatch(/fetch\(resource\.url/)
  })

  it('an external link always opens in a new tab with noopener/noreferrer', () => {
    expect(source).toContain("target=\"_blank\"")
    expect(source).toContain('rel="noopener noreferrer"')
  })

  it('has its own independent loading/error state per lesson — a resource-fetch failure here can never blank the parent lessons list or subject workspace (Section 10 error isolation)', () => {
    expect(source).toMatch(/const \[loading, setLoading\] = useState/)
    expect(source).toMatch(/const \[error, setError\] = useState/)
  })

  it('never fabricates a fake empty/zero state — a genuine failure and "no resources yet" render different, distinguishable text', () => {
    expect(source).toContain('ยังไม่มีสื่อการสอนสำหรับบทเรียนนี้')
    expect(source).toMatch(/if \(error\) return/)
  })
})

describe('LessonResourcesList — Google provider display (Google Drive Integration, Section 3/4/6/9)', () => {
  const source = readSource()

  it('derives provider from the ONE shared resource-provider module, never a second local parser', () => {
    expect(source).toContain("from '@/lib/resource-provider'")
    expect(source).toMatch(/detectResourceProvider\(resource\.url\)/)
  })

  it('the Google Slides preview is optional (click-to-reveal), never automatic like the YouTube embed', () => {
    expect(source).toContain('getGoogleSlidesEmbedUrl')
    expect(source).toContain('showPreview')
    expect(source).toContain("'แสดงตัวอย่างสไลด์'")
  })

  it('always retains a plain open-in-new-tab fallback link alongside any preview, using the shared provider open-label (never hardcoding it locally)', () => {
    expect(source).toContain('PROVIDER_OPEN_LABEL')
    expect(source).toMatch(/<a\s/)
  })

  it('shows the Google sharing-permissions caveat rather than claiming this app controls Drive permissions', () => {
    expect(source).toContain('การแสดงตัวอย่างขึ้นอยู่กับการตั้งค่าสิทธิ์การแชร์ไฟล์ใน Google Slides')
  })
})
