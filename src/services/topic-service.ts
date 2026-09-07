import { getSupabaseClient } from '@/lib/supabase'
import type { CreateTopicInput, Topic, UpdateTopicInput } from '@/types/topic'

interface TopicRow {
  id: string
  subject_id: string
  title: string
  description: string | null
  position: number
  taught_date: string | null
  created_at: string
  updated_at: string
}

function mapTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    subjectId: row.subject_id,
    title: row.title,
    description: row.description,
    position: row.position,
    taughtDate: row.taught_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getTopics(subjectId: string): Promise<Topic[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('topics')
    .select('*')
    .eq('subject_id', subjectId)
    .order('position', { ascending: true })

  if (error) throw error
  return (data as TopicRow[]).map(mapTopic)
}

/**
 * `subject_id` is validated by RLS (topics_insert_own), not by trusting
 * the caller: inserting a topic against a subject you don't own fails
 * with 42501 regardless of what this function is passed.
 */
export async function createTopic(input: CreateTopicInput): Promise<Topic> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('topics')
    .insert({
      subject_id: input.subjectId,
      title: input.title,
      description: input.description ?? null,
      position: input.position ?? 1,
      taught_date: input.taughtDate ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return mapTopic(data as TopicRow)
}

export async function updateTopic(topicId: string, input: UpdateTopicInput): Promise<Topic> {
  const supabase = getSupabaseClient()

  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.description !== undefined) patch.description = input.description
  if (input.position !== undefined) patch.position = input.position
  if (input.taughtDate !== undefined) patch.taught_date = input.taughtDate

  const { data, error } = await supabase
    .from('topics')
    .update(patch)
    .eq('id', topicId)
    .select('*')
    .single()

  if (error) throw error
  return mapTopic(data as TopicRow)
}

export async function deleteTopic(topicId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('topics').delete().eq('id', topicId)

  if (error) throw error
}

/**
 * Swaps the `position` of two topics (used by the reorder up/down
 * controls). Two sequential updateTopic calls rather than one RPC — a
 * failure partway through just leaves the previous order in place (the
 * next reorder attempt or a page refresh recovers cleanly), so this
 * doesn't carry the half-created-row risk that justified an atomic RPC
 * for subject creation.
 */
export async function swapTopicPositions(a: Topic, b: Topic): Promise<void> {
  await updateTopic(a.id, { position: b.position })
  await updateTopic(b.id, { position: a.position })
}
