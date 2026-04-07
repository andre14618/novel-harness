import db from "../../data/connection"

export interface TrainingPair {
  id: string
  task: string
  status: string
  novel_id: string | null
  chapter_number: number | null
  system_prompt: string
  user_content: string
  base_output: string
  gold_output: string | null
  reviewer_notes: string | null
  created_at: string
  reviewed_at: string | null
}

export interface TrainingPairInput {
  task: string
  novel_id?: string | null
  chapter_number?: number | null
  system_prompt: string
  user_content: string
  base_output: string
}

export async function saveTrainingPair(pair: TrainingPairInput): Promise<string> {
  const rows = await db`
    INSERT INTO finetune_training_data (task, novel_id, chapter_number, system_prompt, user_content, base_output)
    VALUES (${pair.task}, ${pair.novel_id ?? null}, ${pair.chapter_number ?? null}, ${pair.system_prompt}, ${pair.user_content}, ${pair.base_output})
    RETURNING id`
  return rows[0].id
}

export async function getTrainingPairs(
  task?: string,
  status?: string,
  limit = 50,
  offset = 0
): Promise<TrainingPair[]> {
  if (task && status) {
    return await db`
      SELECT * FROM finetune_training_data
      WHERE task = ${task} AND status = ${status}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}`
  }
  if (task) {
    return await db`
      SELECT * FROM finetune_training_data
      WHERE task = ${task}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}`
  }
  if (status) {
    return await db`
      SELECT * FROM finetune_training_data
      WHERE status = ${status}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}`
  }
  return await db`
    SELECT * FROM finetune_training_data
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}`
}

export async function getTrainingPair(id: string): Promise<TrainingPair | null> {
  const rows = await db`SELECT * FROM finetune_training_data WHERE id = ${id}`
  return rows[0] ?? null
}

export async function updateTrainingPair(
  id: string,
  data: { gold_output?: string; status?: string; reviewer_notes?: string }
): Promise<TrainingPair | null> {
  const current = await getTrainingPair(id)
  if (!current) return null

  const gold = data.gold_output ?? current.gold_output
  const status = data.status ?? current.status
  const notes = data.reviewer_notes ?? current.reviewer_notes
  const reviewedAt = data.status ? new Date().toISOString() : current.reviewed_at

  const rows = await db`
    UPDATE finetune_training_data
    SET gold_output = ${gold}, status = ${status}, reviewer_notes = ${notes}, reviewed_at = ${reviewedAt}
    WHERE id = ${id}
    RETURNING *`
  return rows[0] ?? null
}

export async function getTrainingStats(task?: string): Promise<Record<string, number>> {
  let rows: any[]
  if (task) {
    rows = await db`
      SELECT status, COUNT(*)::int AS count
      FROM finetune_training_data
      WHERE task = ${task}
      GROUP BY status`
  } else {
    rows = await db`
      SELECT status, COUNT(*)::int AS count
      FROM finetune_training_data
      GROUP BY status`
  }
  const stats: Record<string, number> = { pending: 0, reviewed: 0, approved: 0, rejected: 0 }
  for (const r of rows) stats[r.status] = r.count
  return stats
}

export async function getTrainingStatsByTask(): Promise<Record<string, Record<string, number>>> {
  const rows = await db`
    SELECT task, status, COUNT(*)::int AS count
    FROM finetune_training_data
    GROUP BY task, status
    ORDER BY task`
  const result: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    if (!result[r.task]) result[r.task] = { pending: 0, reviewed: 0, approved: 0, rejected: 0 }
    result[r.task][r.status] = r.count
  }
  return result
}

export async function exportApproved(task: string): Promise<any[]> {
  const rows = await db`
    SELECT system_prompt, user_content, gold_output
    FROM finetune_training_data
    WHERE task = ${task} AND status = 'approved' AND gold_output IS NOT NULL
    ORDER BY created_at`
  return rows.map((r: any) => ({
    messages: [
      { role: "system", content: r.system_prompt },
      { role: "user", content: r.user_content },
      { role: "assistant", content: r.gold_output },
    ],
  }))
}
