import { Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AI_SUGGESTED_PROMPTS, getDemoAiResponse } from '@/demo/ai-responses'
import { useDemoClassroom } from '@/demo/demo-context'

export function AiAssistantCard() {
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const demo = useDemoClassroom()

  function ask(prompt: string) {
    if (!prompt.trim()) return
    setQuery(prompt)
    setAnswer(getDemoAiResponse(prompt, demo))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    ask(query)
  }

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
        <form className="flex gap-2" onSubmit={handleSubmit}>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="เช่น ใครค้างงานมากกว่า 2 งาน?"
          />
          <Button type="submit">ถาม</Button>
        </form>

        <div className="flex flex-wrap gap-2">
          {AI_SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => ask(prompt)}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {prompt}
            </button>
          ))}
        </div>

        {answer && (
          <div className="whitespace-pre-line rounded-lg border border-border bg-background/70 p-3 text-sm">
            {answer}
          </div>
        )}

        <Link to="/teacher/ai" className="inline-block text-xs font-medium text-primary hover:underline">
          เปิด AI Assistant แบบเต็ม →
        </Link>
      </CardContent>
    </Card>
  )
}
