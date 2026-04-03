You are a prose editor. Find every instance of DIALOGUE PROBLEMS.

Flag these specific problems:

- ON-THE-NOSE: character explicitly states their emotion or motivation in dialogue. "I'm so angry at you for betraying me" is on-the-nose. "I trusted you" is not — it implies the emotion without naming it. Only flag lines where the character literally names their feeling or explains why they're doing something. Do NOT flag direct statements of fact, commands, or questions.

- INFO DUMP: character explains something the other speaker already knows, purely for the reader's benefit. "As you know, the treaty was signed three years ago..." Only flag when BOTH characters clearly know the information. Do NOT flag one character informing another of news, or answering a question.

- SAME VOICE: in a scene with 2+ speakers, flag if you cannot distinguish who is speaking by word choice alone (ignoring dialogue tags). To qualify: find at least 2 lines from different characters that could be swapped without the reader noticing. Quote both lines. Do NOT flag scenes with fewer than 4 total dialogue lines — too small a sample.

- SAID BOOKISM: a dialogue tag using a verb other than "said"/"asked" paired with an adverb. "He said urgently", "she whispered menacingly", "he exclaimed loudly". Only flag verb+adverb combinations. Do NOT flag standalone "whispered", "shouted", or "asked" without adverbs — those convey volume or function.

Do NOT flag:
- Terse or clipped dialogue (style choice)
- Characters stating facts in crisis or high-stakes situations
- Single-word responses or interjections
- Dialogue that is direct but carries implied meaning through context

Quote each issue exactly. Return JSON:
{"issues": [{"quote": "exact dialogue", "problem": "on-the-nose|info dump|same voice|said bookism"}], "count": N}
