import { useState, useEffect, useCallback } from "react"
import { getPrefRatings, savePrefRating, exportPrefDpo } from "../api"

// ── V4 benchmark data (tuning_experiment id=98, 2026-04-08) ──────────────────
// NOTE: exp #95 and #96 used the identity LoRA placeholder (howard-tonal-v4:latest = v0).
// Real data uses howard-tonal-v4-sft-resume:v8. V4 wins on every metric.

const HOWARD_REF = { classifier: 0.715, perplexity: 1964, featureKL: 1.534 }
const INPUT_REF  = { classifier: 0.197, perplexity: 3593, featureKL: 1.569 }

const V4_METRICS = {
  v3: { label: "V3 · Together 9B",  classifier: 0.422, perplexity: 4814, featureKL: 1.584, contentPres: 0.275, latencyMs: 1757, color: "#82c4a8" },
  v4: { label: "V4 · W&B 14B",      classifier: 0.550, perplexity: 3086, featureKL: 1.564, contentPres: 0.583, latencyMs: 597,  color: "#c4a8e2" },
}

const V4_PER_PARA = [
  { input: 0.20, v3: 0.500, v4: 0.500 },
  { input: 0.00, v3: 0.000, v4: 0.000 },
  { input: 0.00, v3: 1.000, v4: 0.500 },
  { input: 0.50, v3: 1.000, v4: 1.000 },
  { input: 0.00, v3: 0.000, v4: 0.500 },
  { input: 1.00, v3: 0.333, v4: 1.000 },
  { input: 0.00, v3: 1.000, v4: 0.000 },
  { input: 0.00, v3: 0.000, v4: 0.500 },
  { input: 0.00, v3: 0.000, v4: 0.000 },
  { input: 0.00, v3: 0.000, v4: 0.500 },
  { input: 0.00, v3: 1.000, v4: 0.500 },
  { input: 0.50, v3: 0.500, v4: 1.000 },
  { input: 0.25, v3: 0.000, v4: 1.000 },
  { input: 0.50, v3: 0.500, v4: 1.000 },
  { input: 0.00, v3: 0.500, v4: 0.250 },
]

// ── Full 15-paragraph output dump (exp #98, sft-resume:v8) ──────────────────

const V4_SAMPLES: Array<{ input: string; v3: string; v4: string }> = [
  {
    input: "The soldier moved carefully through the dark corridor, his sword held ready in front of him. He could hear strange sounds coming from somewhere deeper in the ruins, and the air felt cold and damp against his skin. He was starting to feel uncomfortable about the whole situation, but he knew he had to keep going.",
    v3: "The soldier crept through the suffocating dark, sword locked tight before him. Muffled, alien noises dragged from the ruins' depths, while the air bit cold and damp against his skin. Dread clawed at his gut, yet he forced his legs forward.",
    v4: "The soldier advanced warily down the black corridor, his sword extended in front of him. He could hear curious sounds issuing from somewhere farther in the ruins, and the air was cold and clammy against his skin. He was beginning to be very uneasy in his mind, but he knew he must push on.",
  },
  {
    input: "The two warriors circled each other slowly, looking for an opening. Rain fell steadily on the stone courtyard, making the footing treacherous. The taller man attacked first, swinging his blade in a wide arc. The shorter one stepped back quickly and countered with a thrust that was barely deflected. They were both breathing hard now, and it was clear that neither would give up easily.",
    v3: "Rain hammering the stone courtyard turned the ground into slick, deadly mud. Two warriors circled, eyes locked, hunting a fatal flaw in each other's stance. The taller man struck first, his blade carving a wide, hungry arc through the mist. The shorter one vanished backward, then drove home a steel thrust so sharp it barely missed the taller man's throat. Both men gasped, lungs burning, refusing to yield an inch.",
    v4: "The two warriors circled warily, seeking an opening. Rain fell steadily on the stone courtyard, making the footing treacherous. The taller man attacked first, swinging his blade in a wide arc. The shorter one ducked back quickly and countered with a thrust that was barely parried. They were both breathing hard now, and it was obvious that neither would yield without a struggle.",
  },
  {
    input: "The battle had been going on for hours. Bodies lay everywhere on the muddy field. The defenders were exhausted but they refused to retreat. Their leader stood on the wall, shouting encouragement despite the arrow wound in his shoulder.",
    v3: "Hours of slaughter had turned the field into a churned-up grave of mud and flesh. The defenders, bone-deep in exhaustion, drew their swords rather than their legs, refusing to yield an inch. Perched atop the crumbling wall, their commander bellowed orders, blood slicking his fingers where an arrow had torn through his shoulder.",
    v4: "The battle had raged for hours. The mud was red with blood, and the field was strewn with corpses. But the defenders still held their ground. They were worn out, but they would not retreat. Their leader stood on the wall, shouting encouragement, though an arrow was sticking in his shoulder.",
  },
  {
    input: "He drew his sword and charged at the creature. It was larger than a man, covered in dark scales, and its eyes glowed with an unnatural light. The beast swiped at him with enormous claws, and he barely managed to dodge to the side. He struck back, aiming for the exposed throat, and felt his blade bite into flesh.",
    v3: "Steel flashed as he drew and lunged. The beast loomed—a mountain of obsidian scales, its eyes burning with sickly, unnatural fire. Enormous claws tore through the air, screeching as they raked past his ear; he spun on his heel, the wind of the swipe whipping his coat. He met the thrust, driving his blade deep into the creature's exposed throat. The edge sank in with a wet, sickening crunch.",
    v4: "He drew his sword and rushed at the thing. It was taller than a man, hideous with black scales, and its eyes blazed like a maniac's. The beast slashed at him with giant talons, and he barely avoided them by a desperate leap to one side. He lashed out again, and this time he felt his blade sink into a yielding throat.",
  },
  {
    input: "She climbed the crumbling tower stairs, testing each step before putting her full weight on it. The moonlight came through gaps in the stone walls, creating patches of silver light on the dusty floor. From somewhere above, she could hear a rhythmic tapping sound that she could not identify. Her torch was getting low, and she considered turning back, but curiosity drove her forward.",
    v3: "Her boots crunched on the crumbling stair, testing every loose stone before committing her full weight. Moonlight sliced through gaps in the masonry, painting jagged patches of silver across the dust-choked floor. From the darkness above, a rhythmic tap-tap-tap echoed, sharp and unintelligible. Her torch sputtered, its flame dying to a weak red glow. The urge to flee warred with a gnawing hunger for the unknown, and she pressed on.",
    v4: "She went up the crumbling tower stairs, testing each step before she committed her full weight to it, and the moonlight filtered through crevices in the stone walls, making patches of silver glow on the dusty floor. From somewhere above her she heard a rhythmic tapping that she could not identify, and her torch was low, and she hesitated, considering retreat, but curiosity spurred her onward.",
  },
  {
    input: "The castle had been abandoned for many years. Weeds grew through cracks in the courtyard stones, and most of the windows were broken. But something about the place suggested that it was not entirely empty. There were fresh marks in the dust on the floor.",
    v3: "Years of neglect had turned the castle into a rotting tooth in the jaw of the forest. Vines strangled the courtyard stones, shoving their green fingers through hairline fractures, while shattered windows gaped like blind, bleeding eyes. Yet, a heavy, wrong stillness clung to the air, suggesting the place was not truly empty. In the thick, undisturbed dust of the floor, someone had just walked: fresh, dark footprints pressed into the powder, recent and undeniable.",
    v4: "The castle had stood empty for many years. Weeds pushed through the cracks in the courtyard stones, and most of the windows were broken. But there was a suggestion of occupancy about the place. There were fresh tracks in the dust on the floor.",
  },
  {
    input: "The swamp stretched endlessly in every direction. Mist hung low over the dark water, and strange lights flickered in the distance. The trees here were dead, their branches reaching up like skeletal fingers. Every now and then something splashed in the murky water nearby, but he could never see what caused it.",
    v3: "The swamp sprawled without end, a suffocating blanket of stagnant water and rotting vegetation. A thick, gray mist clung to the surface, while faint, unnatural lights blinked like dying eyes in the distance. Dead trees stood as silent sentinels, their gnarled branches clawing at the sky like skeletal fingers. From the murky depths, a splash erupted—sharp and sudden—before vanishing into the gloom, leaving him wondering what monster lurked beneath the surface.",
    v4: "The swamp stretched away endlessly in all directions. Mist hung low over the sullen water, and strange lights glimmered away off in the distance. The trees here were dead, their branches clawing up like the fingers of the dead. Now and then something splashed in the murky water near him, but what it was he could never see.",
  },
  {
    input: "The city was quiet at this hour. Most of the shops were closed, their shutters drawn tight. Only a few torches still burned along the main street, casting pools of orange light on the cobblestones. A cat ran across the road ahead of her, disappearing into a narrow alley.",
    v3: "Silence held the city at this hour. Shop shutters slammed their eyes shut against the dark. Only a few torches lingered on the main street, dripping orange pools onto the cobblestones. A cat darted across the road ahead of her, vanishing into a narrow alley before she could move.",
    v4: "The city was asleep at this hour. Most of the shops were closed, their shutters closely drawn. Only a few torches still smoldered along the main street, lighting up pools of orange light on the cobblestones. A cat darted across the street ahead of her, and vanished into a narrow alley.",
  },
  {
    input: "The woman stood at the edge of the cliff, looking down at the churning sea below. The wind was strong and cold, pulling at her cloak. She had come here to make a decision, and she knew there was no going back once she chose.",
    v3: "She stood on the cliff's edge, staring into the churning abyss below. The wind bit through her cloak, hauling her forward with icy fingers. This was the moment: a choice made, a path sealed, with no retreat possible.",
    v4: "The woman stood on the cliff's edge, looking down into the seething, surging sea that foamed far below her feet. The wind was cold and fierce, whipping at her cloak. She had come here to make a choice, and she knew that once made, there could be no turning back.",
  },
  {
    input: "He woke up in a dark room with no memory of how he had gotten there. His hands were bound and his head was throbbing with pain. Somewhere nearby, he could hear voices speaking in a language he did not understand.",
    v3: "Darkness swallowed him whole. He awoke with no memory of his capture, only the brutal bite of bound hands and a skull-splitting headache. Somewhere in the suffocating quiet, muffled voices drifted, speaking a tongue that felt like static in his ears.",
    v4: "He awoke in a dark room, with no knowledge of how he had come there, his hands tied and his head throbbing with pain. Somewhere in the vicinity he could hear voices speaking in a language unfamiliar to him.",
  },
  {
    input: "Dawn broke over the battlefield. The survivors began to stir, checking their wounds and looking for fallen companions. The enemy had retreated during the night, leaving behind only their dead. Victory felt hollow in the cold morning light.",
    v3: "Dawn cracked open the battlefield, bleaching the mud in a pale, accusing light. Survivors groaned, forcing themselves upright to gouge out their own wounds and drag the bodies of the dead. The enemy had vanished into the night, leaving nothing but a mountain of corpses. In the biting cold, the silence of victory tasted like ash.",
    v4: "Dawn whitened over the blood-splashed field. The survivors were beginning to stir, feeling their wounds and glancing apprehensively about for a fallen comrade. The enemy had withdrawn during the night, leaving only their dead behind them. Triumph was ashes in the cold dawn.",
  },
  {
    input: "The tavern was crowded and noisy. Men were drinking and arguing at every table. In the corner, a hooded figure sat alone, watching the room with careful attention. Nobody seemed to notice him, which was exactly what he wanted.",
    v3: "Smoke choked the tavern, thick with the reek of stale ale and unwashed bodies. Roars and curses erupted from every table as men slammed tankards and drew daggers. In the gloom of a shadowed corner, a hooded figure sat apart, eyes sharp and still, scanning the chaos. The room's deafening din swallowed him whole, rendering him invisible—a perfect, silent ghost among the drunken fools.",
    v4: "The tavern was full and noisy. Men were carousing and quarreling at every table. But in the corner, a hooded figure sat alone, watching the room with hawk-like intensity. But none seemed to take any notice of him, and that was exactly as he wished.",
  },
  {
    input: "The old man looked at him for a long time before speaking. His eyes were sharp despite his age, and there was something unsettling about the way he studied the younger man's face. Finally, he leaned back in his chair and let out a long breath.",
    v3: "The old man fixed him with a stare that held too much weight for his years. His eyes, though clouded with age, burned with a predatory sharpness as they dissected the younger man's expression. Finally, he slumped back, exhaling a ragged breath that seemed to deflate the air between them.",
    v4: "The old man stared at him for a long time before he spoke. His eyes were piercing, in spite of his age, and there was an unpleasant suggestion of analytical intensity about the way he scanned the younger man's face. At last he leaned back in his chair and sighed longingly.",
  },
  {
    input: "The ship rocked violently as the storm grew worse. Waves crashed over the deck, and the crew struggled to keep the sails from tearing apart. The captain stood at the wheel, his face grim and determined as he fought to keep the vessel from capsizing.",
    v3: "The ship hammered against the churning sea, its timbers groaning under the assault of a worsening tempest. Cresting waves smashed over the deck, drenching the crew as they frantically wrestled the rigging to prevent the sails from ripping apart. At the helm, the captain's face was a mask of grim resolve, his hands white-knuckled on the wheel as he fought to keep the vessel from capsizing.",
    v4: "The ship reeled drunkenly as the storm increased in fury. Green walls of water swept over the deck and the crew fought desperately to keep the tattered sails from being ripped from their hales. The captain stood at the wheel, his face set and hard as he strove to keep the vessel from capsizing.",
  },
  {
    input: "The assassin waited on the rooftop, perfectly still. Below, the target walked through the market square, surrounded by guards. She counted them carefully and calculated her approach. The window of opportunity would be very small.",
    v3: "Perched on the slate roof, the assassin held her breath, a statue of shadow against the gray sky. Below, the target cut through the market's roar, flanked by a wall of armored guards. She counted them: three on the left, two on the right, one blocking the rear. The gap in their formation was a hair's breadth, closing fast. She had seconds, not moments.",
    v4: "The assassin waited on the roof, as motionless as a statue. Below, the victim moved through the market square, guarded by a group of men-at-arms. She counted them carefully, and determined her method of approach. The opening for her would be a very narrow window indeed.",
  },
]

// Deterministic shuffle: V3 on left for even-indexed paragraphs, V4 on left for odd
const PREF_PAIRS = V4_SAMPLES.map((s, i) => {
  const aIsV3 = i % 2 === 0
  return { input: s.input, optionA: aIsV3 ? s.v3 : s.v4, optionB: aIsV3 ? s.v4 : s.v3, aIsV3 }
})

const EVAL_NAME = "v3-vs-v4-tonal"

function PrefEvalTab() {
  const [prefs, setPrefs] = useState<Record<number, "a" | "b">>({})
  const [saving, setSaving] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Load saved ratings on mount
  useEffect(() => {
    getPrefRatings(EVAL_NAME).then(({ ratings }) => {
      const restored: Record<number, "a" | "b"> = {}
      for (const row of ratings) {
        const pair = PREF_PAIRS[row.paragraph_index]
        if (!pair) continue
        const aIsChosen = (row.chosen_model === "v3") === pair.aIsV3
        restored[row.paragraph_index] = aIsChosen ? "a" : "b"
      }
      setPrefs(restored)
    }).catch(e => setLoadError(String(e)))
  }, [])

  const pick = useCallback(async (i: number, choice: "a" | "b") => {
    setPrefs(p => p[i] === choice ? p : { ...p, [i]: choice })
    setSaving(i)
    const pair = PREF_PAIRS[i]
    const chosenText  = choice === "a" ? pair.optionA : pair.optionB
    const rejectedText = choice === "a" ? pair.optionB : pair.optionA
    const chosenModel  = (choice === "a") === pair.aIsV3 ? "v3" : "v4"
    const rejectedModel = chosenModel === "v3" ? "v4" : "v3"
    await savePrefRating(EVAL_NAME, {
      paragraphIndex: i,
      inputText: pair.input,
      chosenText,
      rejectedText,
      chosenModel,
      rejectedModel,
    }).catch(e => console.error("save pref failed", e))
    setSaving(null)
  }, [])

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await exportPrefDpo(EVAL_NAME)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${EVAL_NAME}-dpo.jsonl`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error("export failed", e)
    } finally {
      setExporting(false)
    }
  }

  const done = Object.keys(prefs).length
  const v3Wins = Object.entries(prefs).filter(([i, c]) => {
    const pair = PREF_PAIRS[Number(i)]
    return (c === "a" && pair.aIsV3) || (c === "b" && !pair.aIsV3)
  }).length
  const v4Wins = done - v3Wins

  return (
    <div>
      {/* Tally bar */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "var(--bg-primary)", borderBottom: "1px solid var(--border)",
        padding: "0.6rem 0", marginBottom: "1.25rem",
        display: "flex", alignItems: "center", gap: "1.5rem", fontSize: "0.82rem",
        flexWrap: "wrap",
      }}>
        <span style={{ color: "var(--text-secondary)" }}>{done}/15 rated</span>
        {done > 0 && <>
          <span style={{ color: V4_METRICS.v3.color, fontWeight: 600 }}>V3: {v3Wins}</span>
          <span style={{ color: V4_METRICS.v4.color, fontWeight: 600 }}>V4: {v4Wins}</span>
        </>}
        {saving !== null && <span style={{ color: "#666", fontSize: "0.72rem" }}>saving…</span>}
        {loadError && <span style={{ color: "#f85149", fontSize: "0.72rem" }}>{loadError}</span>}

        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {done === 15 && (
            <span style={{
              fontSize: "0.78rem", padding: "0.2rem 0.6rem", borderRadius: "4px",
              background: v3Wins > v4Wins ? "rgba(130,196,168,0.15)" : "rgba(196,168,226,0.15)",
              color: v3Wins > v4Wins ? V4_METRICS.v3.color : V4_METRICS.v4.color, fontWeight: 600,
            }}>
              {v3Wins > v4Wins ? `V3 wins ${v3Wins}–${v4Wins}` : v4Wins > v3Wins ? `V4 wins ${v4Wins}–${v3Wins}` : "Tie"}
            </span>
          )}
          {done > 0 && (
            <button onClick={handleExport} disabled={exporting} style={{
              fontSize: "0.72rem", background: "none", border: "1px solid var(--border)",
              borderRadius: "4px", padding: "0.15rem 0.6rem", color: "var(--text-secondary)",
              cursor: exporting ? "default" : "pointer", opacity: exporting ? 0.5 : 1,
            }}>{exporting ? "exporting…" : "export DPO"}</button>
          )}
        </div>
      </div>

      {/* Paragraph list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {PREF_PAIRS.map((pair, i) => {
          const sel = prefs[i]
          const revealed = sel !== undefined

          const optLabel = (opt: "a" | "b") => {
            if (!revealed) return opt === "a" ? "1" : "2"
            const isV3 = (opt === "a") === pair.aIsV3
            return isV3 ? "V3 · Together 9B" : "V4 · W&B 14B"
          }
          const optColor = (opt: "a" | "b") => {
            if (!revealed) return "var(--text-secondary)"
            return ((opt === "a") === pair.aIsV3) ? V4_METRICS.v3.color : V4_METRICS.v4.color
          }

          return (
            <div key={i}>
              {/* Input */}
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.68rem", color: "#555", flexShrink: 0 }}>P{i + 1} · input</span>
              </div>
              <div style={{
                fontSize: "0.8rem", lineHeight: 1.7, color: "#777",
                background: "var(--bg-secondary)", borderRadius: "6px",
                padding: "0.7rem 0.9rem", marginBottom: "0.5rem",
                borderLeft: "3px solid #444",
              }}>{pair.input}</div>

              {/* Options */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                {(["a", "b"] as const).map(opt => {
                  const isSelected = sel === opt
                  const color = optColor(opt)
                  return (
                    <div key={opt} onClick={() => pick(i, opt)} style={{
                      background: isSelected ? "rgba(78,204,163,0.06)" : "var(--bg-secondary)",
                      border: isSelected ? "2px solid rgba(78,204,163,0.5)" : "2px solid var(--border)",
                      borderRadius: "6px", padding: "0.85rem", cursor: "pointer",
                      transition: "border-color 0.1s",
                    }}>
                      <div style={{
                        fontSize: "0.68rem", color, textTransform: "uppercase",
                        letterSpacing: "0.05em", marginBottom: "0.4rem", fontWeight: 600,
                        display: "flex", alignItems: "center", gap: "0.4rem",
                      }}>
                        {optLabel(opt)}
                        {isSelected && <span style={{ color: saving === i ? "#888" : "#4ecca3" }}>{saving === i ? "·" : "✓"}</span>}
                      </div>
                      <div style={{ fontSize: "0.81rem", lineHeight: 1.75, color: "var(--text-primary)" }}>
                        {opt === "a" ? pair.optionA : pair.optionB}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function V4BenchmarkTab() {
  const r = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d

  const metricRow = (
    label: string, arrow: "↑" | "↓", ref: number, input: number,
    v3: number, v4: number, fmt: (n: number) => string = String,
  ) => {
    const v3wins = arrow === "↑" ? v3 >= v4 : v3 <= v4
    return (
      <tr>
        <td style={{ padding: "0.4rem 0.8rem", color: "var(--text-secondary)", fontSize: "0.8rem" }}>{label} {arrow}</td>
        <td style={{ padding: "0.4rem 0.8rem", textAlign: "right", color: "#888", fontSize: "0.8rem" }}>{fmt(ref)}</td>
        <td style={{ padding: "0.4rem 0.8rem", textAlign: "right", color: "#888", fontSize: "0.8rem" }}>{fmt(input)}</td>
        <td style={{ padding: "0.4rem 0.8rem", textAlign: "right", color: v3wins ? V4_METRICS.v3.color : "var(--text-secondary)", fontWeight: v3wins ? 600 : 400, fontSize: "0.85rem" }}>{fmt(v3)}</td>
        <td style={{ padding: "0.4rem 0.8rem", textAlign: "right", color: !v3wins ? V4_METRICS.v4.color : "var(--text-secondary)", fontWeight: !v3wins ? 600 : 400, fontSize: "0.85rem" }}>{fmt(v4)}</td>
        <td style={{ padding: "0.4rem 0.8rem", textAlign: "center", fontSize: "0.75rem", color: v3wins ? V4_METRICS.v3.color : V4_METRICS.v4.color }}>
          {v3wins ? "V3" : "V4"}
        </td>
      </tr>
    )
  }

  const scoreColor = (s: number, ref = false) => {
    if (ref) return "#888"
    if (s >= 0.7) return "#4ecca3"
    if (s >= 0.4) return "#c4a882"
    if (s >= 0.2) return "#e2a882"
    return "#888"
  }

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ margin: "0 0 0.25rem 0", fontSize: "1rem" }}>V4 Benchmark — tuning_experiment #98</h3>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", margin: 0 }}>
          howard-tonal-v4 (Qwen3-14B · W&B Inference) vs v3 (Qwen3.5-9B · Together AI) · 4,497 curated pairs · 3 epochs · cosine schedule
        </p>
      </div>

      {/* Verdict banner */}
      <div style={{
        background: "rgba(78,204,163,0.08)", border: "1px solid rgba(78,204,163,0.25)",
        borderRadius: "6px", padding: "0.75rem 1rem", marginBottom: "1.5rem", fontSize: "0.82rem",
        color: "var(--text-secondary)", lineHeight: 1.6,
      }}>
        <strong style={{ color: "#4ecca3" }}>V4 wins.</strong>{" "}
        Exp #95/#96 compared base to base (identity LoRA bug — see lessons-learned). Real fine-tune
        at <code>howard-tonal-v4-sft-resume:v8</code> beats V3 on every metric: classifier +0.128,
        perplexity 3086 vs 4814, feature KL matches Howard's rhythm (1.564 vs ref 1.534).{" "}
        <span style={{ color: "#c4a8e2" }}>3× faster than Together (597ms vs 1757ms). V4 deployed to production 2026-04-11.</span>
      </div>

      {/* Metrics table */}
      <div style={{ marginBottom: "2rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Metric", "Howard ref", "Input (bland)", "V3 · Together 9B", "V4 · W&B 14B", "Winner"].map(h => (
                <th key={h} style={{ padding: "0.4rem 0.8rem", textAlign: h === "Metric" ? "left" : h === "Winner" ? "center" : "right", color: "var(--text-secondary)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}
                >{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRow("Classifier", "↑", HOWARD_REF.classifier, INPUT_REF.classifier, V4_METRICS.v3.classifier, V4_METRICS.v4.classifier, n => r(n, 3).toString())}
            {metricRow("Perplexity", "↓", HOWARD_REF.perplexity, INPUT_REF.perplexity, V4_METRICS.v3.perplexity, V4_METRICS.v4.perplexity, n => Math.round(n).toString())}
            {metricRow("Feature KL", "↓", HOWARD_REF.featureKL, INPUT_REF.featureKL, V4_METRICS.v3.featureKL, V4_METRICS.v4.featureKL, n => r(n, 3).toString())}
            {metricRow("Content pres", "↑", 0, 0, V4_METRICS.v3.contentPres, V4_METRICS.v4.contentPres, n => n ? r(n, 3).toString() : "—")}
            {metricRow("Latency (ms)", "↓", 0, 0, V4_METRICS.v3.latencyMs, V4_METRICS.v4.latencyMs, n => n ? Math.round(n).toString() + "ms" : "—")}
          </tbody>
        </table>
      </div>

      {/* Per-paragraph heatmap */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
          Per-paragraph classifier score (higher = more Howard-like)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2rem 1fr 1fr 1fr 4rem", gap: "2px", alignItems: "center" }}>
          <div />
          {["Input", "V3", "V4", "Winner"].map(h => (
            <div key={h} style={{ fontSize: "0.7rem", color: "var(--text-secondary)", textAlign: "center", padding: "0 0.2rem 0.3rem" }}>{h}</div>
          ))}
          {V4_PER_PARA.map((row, i) => {
            const v3wins = row.v3 >= row.v4
            return (
              <>
                <div key={`n${i}`} style={{ fontSize: "0.7rem", color: "#666", textAlign: "right", paddingRight: "0.4rem" }}>P{i + 1}</div>
                {(["input", "v3", "v4"] as const).map(k => (
                  <div key={k} style={{
                    background: `rgba(${k === "v3" ? "130,196,168" : k === "v4" ? "196,168,226" : "180,180,180"},${0.1 + row[k] * 0.7})`,
                    borderRadius: "3px", padding: "0.25rem 0", textAlign: "center",
                    fontSize: "0.72rem", color: scoreColor(row[k], k === "input"),
                    fontWeight: (k === "v3" && v3wins && row.v3 > 0) || (k === "v4" && !v3wins && row.v4 > 0) ? 600 : 400,
                  }}>
                    {r(row[k], 2) || "—"}
                  </div>
                ))}
                <div key={`w${i}`} style={{ fontSize: "0.7rem", textAlign: "center", color: v3wins ? V4_METRICS.v3.color : V4_METRICS.v4.color }}>
                  {row.v3 === row.v4 ? "tie" : v3wins ? "V3" : "V4"}
                </div>
              </>
            )
          })}
        </div>
      </div>

      {/* All 15 paragraph outputs */}
      <div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.8rem" }}>
          Sample outputs — all 15 paragraphs (exp #98, sft-resume:v8)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {V4_SAMPLES.map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: "0.7rem", color: "#666", marginBottom: "0.4rem" }}>P{i + 1}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.6rem" }}>
                {([
                  { label: "Input (bland)", text: s.input, color: "#555" },
                  { label: "V3 · Together 9B", text: s.v3, color: V4_METRICS.v3.color },
                  { label: "V4 · W&B 14B", text: s.v4, color: V4_METRICS.v4.color },
                ] as const).map(({ label, text, color }) => (
                  <div key={label} style={{ background: "var(--bg-secondary)", borderRadius: "6px", padding: "0.85rem", borderLeft: `3px solid ${color}` }}>
                    <div style={{ fontSize: "0.68rem", color, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "0.45rem" }}>{label}</div>
                    <div style={{ fontSize: "0.81rem", lineHeight: 1.75, color: label === "Input (bland)" ? "#777" : "var(--text-primary)" }}>{text}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


export function LoraComparePage() {
  const [tab, setTab] = useState<"v4" | "pref">("v4")

  return (
    <div style={{ padding: "1rem", maxWidth: "100%" }}>
      {/* Header + tabs */}
      <div style={{ marginBottom: "1rem" }}>
        <h2 style={{ margin: "0 0 0.75rem 0" }}>LoRA Style</h2>
        <div style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--border)" }}>
          {([["v4", "V4 Benchmark"], ["pref", "Pref Eval"]] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "0.4rem 1rem", fontSize: "0.8rem", border: "none", background: "none", cursor: "pointer",
              color: tab === t ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: "-1px",
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* V4 benchmark tab */}
      {tab === "v4" && <V4BenchmarkTab />}

      {/* Preference eval tab */}
      {tab === "pref" && <PrefEvalTab />}

    </div>
  )
}
