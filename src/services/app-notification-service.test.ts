import { describe, expect, it, vi } from 'vitest'

const channels: string[] = []
const removed: string[] = []

vi.mock('@/lib/supabase', () => {
  const client = {
    channel(topic: string) {
      channels.push(topic)
      const chan = {
        topic,
        on: () => chan,
        subscribe: (cb: (status: string) => void) => {
          cb('SUBSCRIBED')
          return chan
        },
      }
      return chan
    },
    removeChannel: async (chan: { topic: string }) => {
      removed.push(chan.topic)
      return 'ok'
    },
  }
  return { getSupabaseClient: () => client }
})

const { subscribeToMyNotifications } = await import('./app-notification-service')

describe('subscribeToMyNotifications', () => {
  it('every subscription gets its own channel, so a quick remount never reuses one being removed', () => {
    const statuses: string[] = []
    const handlers = { onChange: () => {}, onStatus: (s: string) => statuses.push(s) }
    const stopA = subscribeToMyNotifications('teacher-1', handlers)
    stopA()
    const stopB = subscribeToMyNotifications('teacher-1', handlers)
    expect(channels).toHaveLength(2)
    expect(channels[0]).not.toBe(channels[1])
    expect(channels.every((t) => t.startsWith('notifications:teacher-1:'))).toBe(true)
    expect(statuses).toEqual(['live', 'live'])
    stopB()
    expect(removed).toEqual(channels)
  })
})
