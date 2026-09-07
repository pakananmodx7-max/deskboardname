import { Bot, Send, Sparkles, User } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AI_SUGGESTED_PROMPTS, getDemoAiResponse } from '@/demo/ai-responses'
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoChatMessage } from '@/demo/types'
import { cn } from '@/lib/utils'

function makeMessage(role: DemoChatMessage['role'], text: string): DemoChatMessage {
  return { id: `${role}-${Date.now()}-${Math.random()}`, role, text }
}

export function AiPage() {
  const demo = useDemoClassroom()
  const [messages, setMessages] = useState<DemoChatMessage[]>([
    makeMessage(
      'assistant',
      'สวัสดีค่ะ ดิฉันคือ AI Classroom Assistant ถามเกี่ยวกับนักเรียน คะแนน งาน หรือการเข้าเรียนได้เลยค่ะ',
    ),
  ])
  const [input, setInput] = useState('')

  function ask(prompt: string) {
    if (!prompt.trim()) return
    const response = getDemoAiResponse(prompt, demo)
    setMessages((prev) => [...prev, makeMessage('user', prompt), makeMessage('assistant', response)])
    setInput('')
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    ask(input)
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AI Classroom Assistant</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ผู้ช่วย AI สำหรับถามเกี่ยวกับนักเรียน คะแนน งาน หรือการเข้าเรียน (เดโม — ยังไม่เชื่อมต่อ LLM จริง)
        </p>
      </div>

      <Card className="flex flex-1 flex-col">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <CardTitle className="text-base">แชทกับ AI Assistant</CardTitle>
          </div>
          <CardDescription>คำตอบสร้างจากข้อมูลเดโมปัจจุบันแบบ deterministic ไม่มีการเรียก LLM</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-muted/30 p-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn('flex gap-2', message.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
              >
                <div
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full',
                    message.role === 'user' ? 'bg-secondary text-secondary-foreground' : 'bg-primary text-primary-foreground',
                  )}
                >
                  {message.role === 'user' ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                </div>
                <div
                  className={cn(
                    'max-w-[80%] whitespace-pre-line rounded-lg px-3 py-2 text-sm',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-card',
                  )}
                >
                  {message.text}
                </div>
              </div>
            ))}
          </div>

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

          <form className="flex gap-2" onSubmit={handleSubmit}>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="เช่น ใครค้างงานมากกว่า 2 งาน?"
            />
            <Button type="submit">
              <Send className="size-4" />
              ส่ง
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
