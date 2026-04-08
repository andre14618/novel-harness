import db from "../../data/connection"

export interface PrefRating {
  paragraphIndex: number
  inputText: string
  chosenText: string
  rejectedText: string
  chosenModel: string
  rejectedModel: string
}

export interface PrefRow {
  paragraph_index: number
  chosen_model: string
  rejected_model: string
  created_at: string
}

const SYSTEM_PROMPT = "Rewrite this paragraph. Make the prose vivid, concrete, and direct."

export async function upsertPref(evalName: string, rating: PrefRating): Promise<void> {
  await db`
    INSERT INTO pref_eval
      (eval_name, paragraph_index, input_text, chosen_text, rejected_text, chosen_model, rejected_model)
    VALUES
      (${evalName}, ${rating.paragraphIndex}, ${rating.inputText},
       ${rating.chosenText}, ${rating.rejectedText}, ${rating.chosenModel}, ${rating.rejectedModel})
    ON CONFLICT (eval_name, paragraph_index)
    DO UPDATE SET
      input_text     = EXCLUDED.input_text,
      chosen_text    = EXCLUDED.chosen_text,
      rejected_text  = EXCLUDED.rejected_text,
      chosen_model   = EXCLUDED.chosen_model,
      rejected_model = EXCLUDED.rejected_model,
      created_at     = NOW()
  `
}

export async function getPrefs(evalName: string): Promise<PrefRow[]> {
  return db`
    SELECT paragraph_index, chosen_model, rejected_model, created_at
    FROM pref_eval
    WHERE eval_name = ${evalName}
    ORDER BY paragraph_index
  `
}

export async function exportDpo(evalName: string): Promise<string> {
  const rows = await db`
    SELECT input_text, chosen_text, rejected_text
    FROM pref_eval
    WHERE eval_name = ${evalName}
    ORDER BY paragraph_index
  `
  return rows.map((r: { input_text: string; chosen_text: string; rejected_text: string }) =>
    JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: r.input_text },
      ],
      chosen:   [{ role: "assistant", content: r.chosen_text }],
      rejected: [{ role: "assistant", content: r.rejected_text }],
    })
  ).join("\n")
}
