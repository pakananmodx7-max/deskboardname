import { Sparkles } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const suggestedPrompts = [
  'สรุปนักเรียนที่ควรติดตาม',
  'ใครยังไม่ส่ง Project 2',
  'สรุปการเข้าเรียนวันนี้',
  'สรุปคะแนนห้องนี้',
]

export function AiAssistantCard() {
  const [query, setQuery] = useState('')

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <CardTitle className="text-base">AI Classroom Assistant</CardTitle>
        </div>
        <CardDescription>ถามเกี่ยวกับนักเรียน คะแนน งาน หรือการเข้าเรียน</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => event.preventDefault()}
        >
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="เช่น ใครค้างงานมากกว่า 2 งาน?"
          />
          <Button type="submit">ถาม</Button>
        </form>

        <div className="flex flex-wrap gap-2">
          {suggestedPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setQuery(prompt)}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {prompt}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
