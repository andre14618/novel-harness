import type { HallucScenario } from "./generate-halluc-data"

export const SCENARIOS: HallucScenario[] = [
  // ========================================================================
  // FANTASY (20 total: 16 train + 4 val)
  // ========================================================================
  {
    // 1 — fantasy / dialogue / medium / 3-char / train
    id: "fantasy_council_drayce",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Lord Halvern Drayce",
      setting: "The Royal Council Chamber, midday, tall windows facing the east courtyard",
      characters: ["Lord Halvern Drayce", "Commander Isolde Venn", "Seer Morven"],
      summary: "Halvern presses Isolde for a decision on the northern offensive while Morven searches the ceiling braziers for an omen.",
    },
    worldBible: {
      locations: [
        { name: "The Royal Council Chamber" },
        { name: "Drayce Keep" },
        { name: "The Northern Reaches" },
        { name: "The Windward Pass" },
      ],
      cultures: [{ name: "House Drayce" }, { name: "The Northern Clans" }],
      systems: [{ name: "Flame Omen Reading" }],
    },
    speakers: {
      "Lord Halvern Drayce": "Clipped, formal sentences. Uses third-person titles when pressing for answers. Never swears. Favors 'I will have an answer' over 'I need an answer'.",
      "Commander Isolde Venn": "Military brevity — verb-first constructions. Avoids conditionals; speaks in declaratives even about uncertain things. 'We march' rather than 'we should march'.",
      "Seer Morven": "Elliptical and trailing. Speaks in question fragments when receiving an omen: 'The wind — do you hear —? Something cold.'",
    },
  },
  {
    // 2 — fantasy / action / thin / 2-char / train
    id: "fantasy_solo_tower_climb",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "action",
      pov: "Kessa Thirrow",
      setting: "The outer face of the Ember Spire, pre-dawn, rain-slick basalt",
      characters: ["Kessa Thirrow", "Spotter Brin Ocha"],
      summary: "Kessa free-climbs the exterior of the spire while Brin, rope-braced at the base, hand-signals the next hold — they have to reach the oriel window before the watch-bell rings.",
    },
    worldBible: {
      locations: [{ name: "The Ember Spire" }, { name: "The Oriel Window" }],
      cultures: [],
      systems: [],
    },
    speakers: {
      "Kessa Thirrow": "Internal monologue in terse, climber's counting rhythm: 'hand, hand, foot, breathe.' Bites off curses mid-word. Thinks in distances, never in feelings.",
      "Spotter Brin Ocha": "Whispered calls only. Uses hand-signs first, words second. Names holds by shape ('knuckle', 'lip', 'pocket').",
    },
  },
  {
    // 3 — fantasy / description / medium / 2-char / train
    id: "fantasy_market_arrival",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "description",
      pov: "Mirren Vale",
      setting: "The Saltcross Market at opening hour, fog still low over the stalls",
      characters: ["Mirren Vale", "Porter Aldith"],
      summary: "Mirren walks the length of Saltcross with Aldith, cataloguing stall-fronts and vendors while searching for the coin-changer's blue awning.",
    },
    worldBible: {
      locations: [
        { name: "The Saltcross Market" },
        { name: "The Blue Awning" },
        { name: "Fisher's Row" },
      ],
      cultures: [{ name: "The Saltcross Guild" }, { name: "The Rivermen" }],
      systems: [{ name: "Guild Stamp Verification" }],
    },
    speakers: {
      "Mirren Vale": "Observational, precise. Notes color, weight, and provenance of goods. Uses mercantile shorthand ('two-weight', 'short measure'). Rarely sentimental.",
      "Porter Aldith": "Deferential; answers in short phrases. Pads sentences with 'mum' and 'if it please.'",
    },
  },
  {
    // 4 — fantasy / interiority / thin / 2-char / train
    id: "fantasy_oath_refusal",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "interiority",
      pov: "Rowan Kest",
      setting: "The Oath-Stone antechamber, candlelit, one attendant at the inner door",
      characters: ["Rowan Kest", "Attendant Mirel"],
      summary: "Rowan waits his turn at the stone while Mirel, silent at the door, periodically checks the sand-glass — he realizes, quietly and finally, that he will not swear.",
    },
    worldBible: {
      locations: [{ name: "The Oath-Stone Antechamber" }, { name: "The Oath-Stone" }],
      cultures: [{ name: "The Kest Line" }],
      systems: [],
    },
    speakers: {
      "Rowan Kest": "Interior voice swings between formal knightly cadence and bitter modern plain-talk. Self-interrupts. Uses the word 'should' as an accusation.",
      "Attendant Mirel": "Near-silent; speaks only in ritual phrases ('your hour turns') and never deviates.",
    },
  },
  {
    // 5 — fantasy / dialogue / dense / 3-char / train
    id: "fantasy_treaty_table",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Envoy Salvia Arden",
      setting: "The Mirror Hall of the Moonward Palace, late evening, treaty tablets laid out on black felt",
      characters: ["Envoy Salvia Arden", "High Magister Colm Veyren", "Warden-Captain Brissa Lune"],
      summary: "Salvia walks Colm through a proposed border adjustment while Brissa, refusing to sit, objects to the inclusion of the eastern salt pans.",
    },
    worldBible: {
      locations: [
        { name: "The Mirror Hall" },
        { name: "The Moonward Palace" },
        { name: "The Eastern Salt Pans" },
        { name: "The Lune Fortress" },
        { name: "The Arden Ford" },
        { name: "Veyren's Reach" },
      ],
      cultures: [
        { name: "The Moonward Court" },
        { name: "The Lune Wardens" },
        { name: "The Arden Envoys" },
        { name: "The Salt Guild" },
      ],
      systems: [{ name: "Treaty Tablet Inscription" }, { name: "The Border Ledger" }],
    },
    speakers: {
      "Envoy Salvia Arden": "Diplomatic — stacks qualifying clauses, answers questions with questions, deflects with 'we might consider.' Only drops the formality when cornered.",
      "High Magister Colm Veyren": "Slow, over-enunciated, fond of parenthetical historical references ('as in the Third Concord...'). Repeats his interlocutor's last phrase before answering.",
      "Warden-Captain Brissa Lune": "Direct to the point of rudeness. Refuses titles. Speaks in two-clause sentences: statement, then correction. 'The pans are ours. They were always ours.'",
    },
  },
  {
    // 6 — fantasy / action / medium / 2-char / train
    id: "fantasy_bridge_ambush",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "action",
      pov: "Sergeant Faroe Neel",
      setting: "The Ironspan Bridge at dusk, wind strong off the gorge",
      characters: ["Sergeant Faroe Neel", "Cutter Paive"],
      summary: "Faroe and Paive spring their ambush on the courier at the midpoint of the bridge — Faroe on the rope, Paive at the far abutment.",
    },
    worldBible: {
      locations: [
        { name: "The Ironspan Bridge" },
        { name: "The Gorge of Kest" },
        { name: "The Western Abutment" },
        { name: "The Eastern Abutment" },
      ],
      cultures: [{ name: "The Free Cutters" }, { name: "The Courier Company" }],
      systems: [],
    },
    speakers: {
      "Sergeant Faroe Neel": "Military shorthand. Gives orders in two words: 'rope now.' Curses in a dialect-specific mild form ('cricks', 'blast').",
      "Cutter Paive": "Lean, dry, responds to orders with single-word confirmations. Uses the word 'set' for nearly anything.",
    },
  },
  {
    // 7 — fantasy / interiority / medium / 2-char / train
    id: "fantasy_library_doubt",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "interiority",
      pov: "Archivist Celen Druell",
      setting: "The Ninth Tier of the Archival Stacks, late night, only her reading-lamp lit",
      characters: ["Archivist Celen Druell", "Apprentice Vey Holm"],
      summary: "Celen, working late with the forged codex, realizes the High Chancellor commissioned it and weighs what to do while Vey reshelves in the next aisle.",
    },
    worldBible: {
      locations: [
        { name: "The Archival Stacks" },
        { name: "The Ninth Tier" },
        { name: "The Chancellor's Wing" },
        { name: "The Druell Cloister" },
      ],
      cultures: [{ name: "The Archivist Order" }, { name: "The Chancellor's Court" }],
      systems: [{ name: "Codex Authentication Protocol" }],
    },
    speakers: {
      "Archivist Celen Druell": "Scholarly precision; she phrases doubts as bibliographic problems ('the gathering order is wrong'). Avoids emotional vocabulary even when describing panic.",
      "Apprentice Vey Holm": "Quiet, diligent; occasional check-in questions across the aisle, always about classification.",
    },
  },
  {
    // 8 — fantasy / description / thin / 2-char / train
    id: "fantasy_forge_tour",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "description",
      pov: "Apprentice Gera Holm",
      setting: "The lower forge floor of the Warden Smithy, midafternoon",
      characters: ["Apprentice Gera Holm", "Master Smith Uld"],
      summary: "Gera follows Uld along the floor as he points out the quenching trough, the billet rack, and the hammer he refuses to touch.",
    },
    worldBible: {
      locations: [{ name: "The Warden Smithy" }, { name: "The Quenching Trough" }],
      cultures: [{ name: "The Warden Smiths" }],
      systems: [],
    },
    speakers: {
      "Apprentice Gera Holm": "Nervous, asks two questions for every answer, uses technical terms slightly wrong and corrects herself mid-sentence.",
      "Master Smith Uld": "Gruff; speaks in imperatives and single syllables. 'Touch.' 'Listen.' 'No.'",
    },
  },
  {
    // 9 — fantasy / dialogue / medium / 2-char / train
    id: "fantasy_thief_confession",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Magistrate Eleyn Brask",
      setting: "A stone interrogation cell beneath the Stonerow Courthouse, lantern on the table",
      characters: ["Magistrate Eleyn Brask", "The prisoner Wess Tull"],
      summary: "Eleyn tries to get Wess to confess to the Mirror Quarter theft before the assizes convene at dawn.",
    },
    worldBible: {
      locations: [
        { name: "The Stonerow Courthouse" },
        { name: "The Mirror Quarter" },
        { name: "The Assizes Hall" },
      ],
      cultures: [{ name: "The Magistracy" }, { name: "The Crosshand Gang" }],
      systems: [{ name: "The Assize Book" }],
    },
    speakers: {
      "Magistrate Eleyn Brask": "Deliberate, Socratic. Asks the same question three different ways. Softens threats with subjunctives.",
      "Wess Tull": "Street cant; drops the ends of verbs ('goin', 'takin'). Deflects with jokes that aren't quite jokes.",
    },
  },
  {
    // 10 — fantasy / action / thin / 2-char / train
    id: "fantasy_orchard_flight",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "action",
      pov: "Ander Quill",
      setting: "The Quill family orchard at dawn, heavy frost, low sun",
      characters: ["Ander Quill", "Sister Nela Quill"],
      summary: "Ander drags Nela, still limping, between the apple rows as the pursuit cuts across the stone wall behind them.",
    },
    worldBible: {
      locations: [{ name: "The Quill Orchard" }, { name: "The Cider Shed" }],
      cultures: [{ name: "The Quill Family" }],
      systems: [],
    },
    speakers: {
      "Ander Quill": "Tight, breath-clipped imperatives — 'down, down, move.' Between sentences, silence, not filler.",
      "Sister Nela Quill": "Gasping short phrases. Asks one question repeatedly: 'how far?'",
    },
  },
  {
    // 11 — fantasy / dialogue / dense / 3-char / train
    id: "fantasy_guild_trial",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Guildmistress Ysolt Pren",
      setting: "The Guildhall Floor at the Harper's Consortium, midday, full assembly",
      characters: ["Guildmistress Ysolt Pren", "Journeyman Darrin Kole", "Witness Merine Ost"],
      summary: "Ysolt conducts the trial of Darrin for a broken binding contract, taking testimony from Merine as the hall votes.",
    },
    worldBible: {
      locations: [
        { name: "The Guildhall Floor" },
        { name: "The Harper's Consortium" },
        { name: "The Oath Ring" },
        { name: "The Kole Workshop" },
        { name: "The Ost Chandlery" },
      ],
      cultures: [
        { name: "The Harper's Consortium" },
        { name: "The Binding Council" },
        { name: "The Chandler's Compact" },
      ],
      systems: [{ name: "Guild Binding Contract" }, { name: "The Oath Ring Ritual" }],
    },
    speakers: {
      "Guildmistress Ysolt Pren": "Procedural — cites clause numbers, announces each stage of the trial formally. Softens only in the pauses.",
      "Journeyman Darrin Kole": "Defensive, interrupts himself, oscillates between humility and anger mid-sentence.",
      "Witness Merine Ost": "Careful, repeats the question before answering. Hedges every claim with 'to the best of my seeing.'",
    },
  },
  {
    // 12 — fantasy / description / medium / 2-char / train
    id: "fantasy_chapel_vigil",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "description",
      pov: "Brother Eust Valen",
      setting: "The Chapel of the Pale Light, pre-dawn, heavy snow outside",
      characters: ["Brother Eust Valen", "Novice Harn Bell"],
      summary: "Eust walks the length of the chapel on his dawn vigil with Harn trailing a pace behind, noting the snuffed candles, the disordered psalter, and the footprints he cannot explain.",
    },
    worldBible: {
      locations: [
        { name: "The Chapel of the Pale Light" },
        { name: "The Vesper Doors" },
        { name: "The Psalter Stand" },
      ],
      cultures: [{ name: "The Order of the Pale Light" }],
      systems: [{ name: "The Dawn Vigil" }],
    },
    speakers: {
      "Brother Eust Valen": "Liturgical cadence in his thoughts; uses archaic forms ('where went it', 'who durst'). Slips into plain speech when frightened.",
      "Novice Harn Bell": "Nervous, tries to match Eust's formal cadence and keeps failing. Whispered asides, liturgy mis-quoted.",
    },
  },
  {
    // 13 — fantasy / interiority / medium / 2-char / train
    id: "fantasy_letter_shame",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "interiority",
      pov: "Lady Ettrien Faught",
      setting: "A private solar in Faught Manor, late afternoon, rain on the lead glass",
      characters: ["Lady Ettrien Faught", "Maid Coris"],
      summary: "Ettrien rereads her sister's letter while Coris mends in the window seat, and measures, quietly, the difference between what she'll do and what she wants to do.",
    },
    worldBible: {
      locations: [
        { name: "Faught Manor" },
        { name: "The Solar" },
        { name: "The Faught Holdings" },
      ],
      cultures: [{ name: "House Faught" }],
      systems: [{ name: "The Succession Ledger" }],
    },
    speakers: {
      "Lady Ettrien Faught": "Thought-voice veers between epistolary formality (she imagines her reply as she reads) and sharp modern self-talk. Counts breaths between sentences.",
      "Maid Coris": "Warm, pragmatic; uses domestic images ('a torn hem, nothing more'). Deflects heavy subjects.",
    },
  },
  {
    // 14 — fantasy / action / medium / 3-char / train
    id: "fantasy_wagon_rescue",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "action",
      pov: "Outrider Jess Maven",
      setting: "A wagon road skirting the Black Fens, late afternoon, wheels sunk to the axle",
      characters: ["Outrider Jess Maven", "Driver Hul Tath", "Merchant Ferren Ord"],
      summary: "Jess unhooks the lead horse while Hul braces the wheel and Ferren fumbles the strongbox, as the fen-mist closes in from the east.",
    },
    worldBible: {
      locations: [
        { name: "The Black Fens" },
        { name: "The Wagon Road" },
        { name: "Ord's Way Station" },
      ],
      cultures: [{ name: "The Outriders" }, { name: "The Ord Merchant House" }],
      systems: [],
    },
    speakers: {
      "Outrider Jess Maven": "Terse, action-first. Names horses before people. Uses 'hold' as an all-purpose command.",
      "Driver Hul Tath": "Muttering, superstitious; short prayers scattered through his work-speech.",
      "Merchant Ferren Ord": "Panicked, talks too much. Repeats inventory items to himself.",
    },
  },
  {
    // 15 — fantasy / dialogue / dense / 2-char / train
    id: "fantasy_tavern_plan",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Toby Mirn",
      setting: "A back booth of the Split Lantern tavern, late night, the regular crowd thinning",
      characters: ["Toby Mirn", "Graia Wayle"],
      summary: "Toby pitches Graia on running the Brinewater dock job — she either joins tonight or he walks and does it with the Low-Stair crew instead.",
    },
    worldBible: {
      locations: [
        { name: "The Split Lantern" },
        { name: "The Brinewater Dock" },
        { name: "The Low Stair" },
        { name: "The Customs Shed" },
        { name: "The Mirn Boarding House" },
      ],
      cultures: [
        { name: "The Lantern Regulars" },
        { name: "The Low-Stair Crew" },
        { name: "The Brinewater Customs" },
      ],
      systems: [{ name: "The Customs Seal" }, { name: "The Night-Watch Rota" }],
    },
    speakers: {
      "Toby Mirn": "Fast-talking, loops back to the same three selling points. Uses 'listen' as punctuation.",
      "Graia Wayle": "Unhurried. Answers questions by asking a harder one. Smiles through bad news.",
    },
  },
  {
    // 16 — fantasy / action / medium / 2-char / train
    id: "fantasy_ruin_survey",
    genre: "fantasy",
    split: "train",
    brief: {
      kind: "action",
      pov: "Scholar Anys Torune",
      setting: "A collapsed cloister of the Sunken Abbey, afternoon, birds nesting in the broken vaults",
      characters: ["Scholar Anys Torune", "Warder Pell Hess"],
      summary: "Anys braces the loose lintel while Pell levers the reliquary slab aside — they have minutes before the north wall shifts again.",
    },
    worldBible: {
      locations: [
        { name: "The Sunken Abbey" },
        { name: "The Reliquary Niche" },
        { name: "The North Wall" },
      ],
      cultures: [{ name: "The Abbey Warders" }, { name: "The Torune Scholars" }],
      systems: [{ name: "The Reliquary Seal" }],
    },
    speakers: {
      "Scholar Anys Torune": "Catalog cadence — short observational sentences, parenthetical measurements ('two palm-widths deep'). Drifts to wonder only when she thinks no one is watching.",
      "Warder Pell Hess": "Professional, spare. Gives load-bearing warnings as cardinal numbers: 'three, hold.'",
    },
  },
  // fantasy val (4)
  {
    // 17 — fantasy / dialogue / medium / 2-char / val
    id: "fantasy_betrayal_stairs",
    genre: "fantasy",
    split: "val",
    brief: {
      kind: "dialogue",
      pov: "Captain Rian Dovvel",
      setting: "The Broken Stair of the Highlight Fortress, torchlit, wind funneling up from below",
      characters: ["Captain Rian Dovvel", "Lieutenant Hale Prest"],
      summary: "Rian confronts Hale on the stair, asking why the night-gate seal was removed from the log — he does not expect a straight answer.",
    },
    worldBible: {
      locations: [
        { name: "The Highlight Fortress" },
        { name: "The Broken Stair" },
        { name: "The Night Gate" },
      ],
      cultures: [{ name: "The Dovvel Garrison" }],
      systems: [{ name: "The Seal Log" }],
    },
    speakers: {
      "Captain Rian Dovvel": "Quiet, precise. Asks the painful question in the form of a procedural one. Uses rank as armor.",
      "Lieutenant Hale Prest": "Over-explains, then trims the explanation to a shorter lie. Starts half his sentences with 'sir, I —'",
    },
  },
  {
    // 18 — fantasy / action / dense / 3-char / val
    id: "fantasy_siege_breach",
    genre: "fantasy",
    split: "val",
    brief: {
      kind: "action",
      pov: "Banneret Olen Karsh",
      setting: "The Inner Breach of the Stoneflight Wall, first hour after the gate fell, smoke still thick",
      characters: ["Banneret Olen Karsh", "Engineer Vasne Toll", "Pikesman Drien Loft"],
      summary: "Olen holds the breach with Drien's pikes while Vasne rigs the murder-chute above the second arch — they have a quarter-hour before the southern column arrives.",
    },
    worldBible: {
      locations: [
        { name: "The Stoneflight Wall" },
        { name: "The Inner Breach" },
        { name: "The Second Arch" },
        { name: "The Murder Chute" },
        { name: "The Southern Column Road" },
        { name: "The Karsh Banner Camp" },
      ],
      cultures: [
        { name: "The Karsh Bannerets" },
        { name: "The Stoneflight Engineers" },
        { name: "The Pike Companies" },
      ],
      systems: [{ name: "The Chute Trigger Protocol" }, { name: "The Banner Signal Code" }],
    },
    speakers: {
      "Banneret Olen Karsh": "Shouted, clipped commands. Calls men by surname only under fire. Relies on signal-names for rotations.",
      "Engineer Vasne Toll": "Technical muttering layered over orders to assistants we don't see — 'pin, pin, rope, pin' — to herself.",
      "Pikesman Drien Loft": "Spare; counts in rhythm under his breath. Answers 'set' or 'no.'",
    },
  },
  {
    // 19 — fantasy / interiority / thin / solo / val
    id: "fantasy_exile_road",
    genre: "fantasy",
    split: "val",
    brief: {
      kind: "interiority",
      pov: "Rennick Vaul",
      setting: "An empty stretch of the Coast Road, sundown, sea to his right",
      characters: ["Rennick Vaul"],
      summary: "Rennick walks the road out of his homeland and realizes he has already stopped missing the specific things he thought he would miss.",
    },
    worldBible: {
      locations: [{ name: "The Coast Road" }, { name: "The Vaul Homestead" }],
      cultures: [],
      systems: [],
    },
    speakers: {
      "Rennick Vaul": "Interior voice in long, unpunctuated drifts broken by short declarative stops. Catalogs small objects to avoid catalogs of feelings.",
    },
  },
  {
    // 20 — fantasy / dialogue / medium / 2-char / val
    id: "fantasy_throneroom_approach",
    genre: "fantasy",
    split: "val",
    brief: {
      kind: "dialogue",
      pov: "Herald Pren Ashlow",
      setting: "The full length of the Throne Approach, processional hour, banners drawn aside",
      characters: ["Herald Pren Ashlow", "Page Ewen Mull"],
      summary: "Pren walks the Approach with Ewen beside him and quizzes the boy on the bannered lineages, the stepped dais, and the low door the queen uses when she does not wish to be seen entering.",
    },
    worldBible: {
      locations: [
        { name: "The Throne Approach" },
        { name: "The Stepped Dais" },
        { name: "The Low Door" },
        { name: "The Banner Arches" },
      ],
      cultures: [
        { name: "The Heralds of the Approach" },
        { name: "The Ashlow Line" },
        { name: "The Royal Pages" },
      ],
      systems: [{ name: "The Banner Precedence Order" }],
    },
    speakers: {
      "Herald Pren Ashlow": "Instructional, almost lecturing. Describes objects in heraldic vocabulary even when unnecessary.",
      "Page Ewen Mull": "Asks questions only when Pren pauses. Nervous pauses.",
    },
  },

  // ========================================================================
  // DARK-FANTASY (6 total: 5 train + 1 val)
  // ========================================================================
  {
    // 21 — dark-fantasy / action / medium / 2-char / train
    id: "darkfantasy_crypt_harvest",
    genre: "dark-fantasy",
    split: "train",
    brief: {
      kind: "action",
      pov: "Mortician Halven Crue",
      setting: "The lower vault of the Ashen Ossuary, low guttering lamps, standing water",
      characters: ["Mortician Halven Crue", "Acolyte Pell"],
      summary: "Halven harvests the marrow from the fresh cadaver on the slab while Pell holds the pan and tries not to look at the face.",
    },
    worldBible: {
      locations: [
        { name: "The Ashen Ossuary" },
        { name: "The Lower Vault" },
        { name: "The Slab Room" },
      ],
      cultures: [{ name: "The Morticians' Order" }],
      systems: [{ name: "The Marrow Rite" }],
    },
    speakers: {
      "Mortician Halven Crue": "Dispassionate, technical. Narrates each incision as instruction to the acolyte. Uses the word 'subject' instead of any name.",
      "Acolyte Pell": "Terse, swallowing nausea. Short confirmations only.",
    },
  },
  {
    // 22 — dark-fantasy / interiority / thin / 2-char / train
    id: "darkfantasy_witch_bargain",
    genre: "dark-fantasy",
    split: "train",
    brief: {
      kind: "interiority",
      pov: "Ilsa Rook",
      setting: "A mud-floored hut at the edge of the Hollow Moor, deep night, the fire gone out",
      characters: ["Ilsa Rook", "The Moor-Thing"],
      summary: "Ilsa sits across from the thing that answered her summons and considers, carefully, what it will cost her to ask for her son back.",
    },
    worldBible: {
      locations: [{ name: "The Hollow Moor" }, { name: "Ilsa's Hut" }],
      cultures: [],
      systems: [{ name: "The Rook Summoning" }],
    },
    speakers: {
      "Ilsa Rook": "Interior voice flat and practical — she measures cost as she would measure meal. Refuses the language of hope.",
      "The Moor-Thing": "Speaks in patient, grammatical sentences that never quite answer the question asked. Uses Ilsa's own phrases back at her, unchanged.",
    },
  },
  {
    // 23 — dark-fantasy / dialogue / dense / 3-char / train
    id: "darkfantasy_council_pact",
    genre: "dark-fantasy",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Countess Mavet Osel",
      setting: "The Obsidian Round of the Fallen House, candles burned to stubs, rain on the leaded dome",
      characters: ["Countess Mavet Osel", "Chancellor Vrey Bask", "Liche-Speaker Auran"],
      summary: "Mavet negotiates the terms under which the Fallen House will lend its bone-legion to the Chancellor's war — Auran corrects each of Bask's mistranslations of the old compact.",
    },
    worldBible: {
      locations: [
        { name: "The Obsidian Round" },
        { name: "The Fallen House" },
        { name: "The Bone Pits" },
        { name: "The Chancellor's Palace" },
        { name: "The Mourner's Gate" },
      ],
      cultures: [
        { name: "The Fallen House" },
        { name: "The Chancellor's Council" },
        { name: "The Liche-Speakers" },
        { name: "The Bone-Legion" },
      ],
      systems: [{ name: "The Old Compact" }, { name: "The Bone Levy" }],
    },
    speakers: {
      "Countess Mavet Osel": "Cold, ornate; period syntax, long balanced clauses. Smiles she describes to herself, never shows.",
      "Chancellor Vrey Bask": "Impatient, tries to rush the ceremonial language. Misuses archaic terms and doesn't notice.",
      "Liche-Speaker Auran": "Voice narrated as 'dry' and 'paginal' — speaks in quoted fragments from the compact. Pauses before corrections.",
    },
  },
  {
    // 24 — dark-fantasy / description / medium / solo / train
    id: "darkfantasy_plague_street",
    genre: "dark-fantasy",
    split: "train",
    brief: {
      kind: "description",
      pov: "Warden Tess Marrow",
      setting: "The Rat Quarter at the third week of the fever, midmorning, doors chalked with the black cross",
      characters: ["Warden Tess Marrow"],
      summary: "Tess walks her assigned street, cataloguing the chalked doors, the cart-tracks, and the single unmarked house where the lamp is still lit at noon.",
    },
    worldBible: {
      locations: [
        { name: "The Rat Quarter" },
        { name: "The Unmarked House" },
        { name: "The Plague Cart Route" },
      ],
      cultures: [{ name: "The Wardens of the Cross" }, { name: "The Rat Quarter Parish" }],
      systems: [{ name: "The Chalk Cross Rite" }],
    },
    speakers: {
      "Warden Tess Marrow": "Clinical cataloguing; numbered observations. Refuses metaphor. Every so often the discipline slips and a single grief-image lands.",
    },
  },
  {
    // 25 — dark-fantasy / action / dense / 2-char / train
    id: "darkfantasy_sewer_flight",
    genre: "dark-fantasy",
    split: "train",
    brief: {
      kind: "action",
      pov: "Jex Reemer",
      setting: "The lower run of the Iron Sewers, ankle-deep in runoff, lantern half-flooded",
      characters: ["Jex Reemer", "Ash Konna"],
      summary: "Jex drags Ash through the collapsing run, following the chalk arrows past the Tannery Junction and the Bone Chute, trying to reach the overflow grate before the Rendworn hounds close the gap.",
    },
    worldBible: {
      locations: [
        { name: "The Iron Sewers" },
        { name: "The Overflow Grate" },
        { name: "The Tannery Junction" },
        { name: "The Bone Chute" },
        { name: "The Old Warrens" },
      ],
      cultures: [
        { name: "The Rendworn Kennels" },
        { name: "The Chalk Runners" },
        { name: "The Undercity Council" },
      ],
      systems: [{ name: "The Chalk Arrow Code" }, { name: "The Grate Cycle" }],
    },
    speakers: {
      "Jex Reemer": "Sharp, economical, breath-torn. Gives directions as grunted arrows: 'left — left — down.'",
      "Ash Konna": "Injured, distant, asks questions that don't fit the moment ('was the chalk mine?').",
    },
  },
  // dark-fantasy val (1)
  {
    // 26 — dark-fantasy / dialogue / medium / 2-char / val
    id: "darkfantasy_mirror_spirit",
    genre: "dark-fantasy",
    split: "val",
    brief: {
      kind: "dialogue",
      pov: "Sister Vela Trent",
      setting: "A shuttered cell in the Mirror Priory, candlelit, the black-glass pane draped",
      characters: ["Sister Vela Trent", "The Thing in the Mirror"],
      summary: "Vela, forbidden by rule to uncover the mirror, negotiates through the drape with the voice that answers — it wants a name, and she has come prepared to give one.",
    },
    worldBible: {
      locations: [
        { name: "The Mirror Priory" },
        { name: "The Cell of the Black Glass" },
        { name: "The Black-Glass Pane" },
      ],
      cultures: [{ name: "The Sisters of the Mirror" }],
      systems: [{ name: "The Rule of the Drape" }],
    },
    speakers: {
      "Sister Vela Trent": "Liturgical, controlled. Pauses between each sentence. Never addresses the Thing by any pronoun.",
      "The Thing in the Mirror": "Imitative — answers in phrases Vela has already said, with the stresses wrong. Slides toward her vocabulary by the end of the exchange.",
    },
  },

  // ========================================================================
  // PORTAL-FANTASY (4 total: 3 train + 1 val)
  // ========================================================================
  {
    // 27 — portal-fantasy / dialogue / medium / 2-char / train
    id: "portal_arrival_guide",
    genre: "portal-fantasy",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Devon Karr",
      setting: "A roadside shrine at the edge of the Mirrored Marches, first morning after crossing",
      characters: ["Devon Karr", "Pilgrim Mara Seth"],
      summary: "Devon, still wearing his commuter jacket, asks Mara what the chalked sigil on the shrine means — she answers more than he expects.",
    },
    worldBible: {
      locations: [
        { name: "The Mirrored Marches" },
        { name: "The Roadside Shrine" },
        { name: "The Pilgrim Road" },
      ],
      cultures: [{ name: "The Pilgrims of the Mirror" }, { name: "The March Folk" }],
      systems: [{ name: "The Sigil Chalking" }],
    },
    speakers: {
      "Devon Karr": "Modern American casual; filler words ('like', 'honestly'). Asks real-world clarifying questions that don't land.",
      "Pilgrim Mara Seth": "Old-cadenced, patient. Translates concepts into Devon-ready analogies ('it is like a sign on a road, yes, but older').",
    },
  },
  {
    // 28 — portal-fantasy / interiority / thin / 2-char / train
    id: "portal_homesick_inn",
    genre: "portal-fantasy",
    split: "train",
    brief: {
      kind: "interiority",
      pov: "Annika Holt",
      setting: "A small rented room above the Hearth-and-Horn Inn, rain on the shutter, one candle",
      characters: ["Annika Holt", "Innkeeper Dres Wynn"],
      summary: "Annika, three weeks into the crossing, tries to remember the exact layout of her mother's kitchen and cannot — Dres knocks with the warmed wash-basin and stays longer than he needs to.",
    },
    worldBible: {
      locations: [{ name: "The Hearth-and-Horn Inn" }],
      cultures: [],
      systems: [],
    },
    speakers: {
      "Annika Holt": "Modern-voiced interiority; sentences reach for specific nouns from home (brand names, street names) and go soft when she can't retrieve them.",
      "Innkeeper Dres Wynn": "Warm, roundabout, fills silences with small house-business ('the water's hot, mind'). Won't leave until she says something.",
    },
  },
  {
    // 29 — portal-fantasy / description / medium / 3-char / train
    id: "portal_market_bargain",
    genre: "portal-fantasy",
    split: "train",
    brief: {
      kind: "description",
      pov: "Jamie Orrel",
      setting: "The Copperlight Market at midday, stalls of cloth and dried fruit, the Marches sun unfamiliar",
      characters: ["Jamie Orrel", "Stallwoman Bera Ost", "Guildman Hett Voller"],
      summary: "Jamie watches Bera haggle with Hett over the price of a length of linen while trying to decode the currency and the unspoken rules.",
    },
    worldBible: {
      locations: [
        { name: "The Copperlight Market" },
        { name: "The Cloth Row" },
        { name: "The Mirrored Marches" },
      ],
      cultures: [
        { name: "The Copperlight Guild" },
        { name: "The Market Wardens" },
        { name: "The Ost Weavers" },
      ],
      systems: [{ name: "Guild Coin Certification" }],
    },
    speakers: {
      "Jamie Orrel": "Observational, modern voice; her internal asides translate prices into dollars without realizing.",
      "Stallwoman Bera Ost": "Rhythmic haggling; repeats the offered price as a question, then names a higher one.",
      "Guildman Hett Voller": "Official, pedantic, cites guild rules for every move.",
    },
  },
  // portal val (1)
  {
    // 30 — portal-fantasy / action / thin / solo / val
    id: "portal_crossing_chase",
    genre: "portal-fantasy",
    split: "val",
    brief: {
      kind: "action",
      pov: "Priya Nadar",
      setting: "A brick service alley on the near side of the threshold, blending into a forest clearing on the far side, noon",
      characters: ["Priya Nadar"],
      summary: "Priya sprints through the threshold as the alley behind her collapses into the forest, the seam narrowing around her ankles.",
    },
    worldBible: {
      locations: [{ name: "The Threshold Alley" }, { name: "The Forest Clearing" }],
      cultures: [],
      systems: [{ name: "The Seam Calibration" }],
    },
    speakers: {
      "Priya Nadar": "Modern, athletic self-narration; breath-counting, curse-fragment, and one repeated instruction to herself: 'don't look.'",
    },
  },

  // ========================================================================
  // GAMELIT (4 total: 4 train + 0 val)
  // ========================================================================
  {
    // 31 — gamelit / action / medium / 2-char / train
    id: "gamelit_dungeon_entry",
    genre: "gamelit",
    split: "train",
    brief: {
      kind: "action",
      pov: "Ryn Halder",
      setting: "The first-floor entry hall of the Glass Catacomb, the intro trigger fired, translucent mobs rendering in",
      characters: ["Ryn Halder", "Partymate Cell Voskin"],
      summary: "Ryn opens with a pull on the nearest Glass Revenant while Cell warms the Bleed Ward — they have twelve seconds before the hallway respawn ticks.",
    },
    worldBible: {
      locations: [
        { name: "The Glass Catacomb" },
        { name: "The First-Floor Entry Hall" },
        { name: "The Respawn Gate" },
      ],
      cultures: [{ name: "The Open Rift Server" }],
      systems: [
        { name: "Bleed Ward" },
        { name: "Respawn Tick Counter" },
        { name: "Pull Timer" },
      ],
    },
    speakers: {
      "Ryn Halder": "Gamer callouts — ability names mid-combat, cooldown math as exclamation: 'Bleed up in three.' Uses 'inc' and 'add' as shorthand.",
      "Cell Voskin": "Dry, deadpan. Reports ward status in percent.",
    },
  },
  {
    // 32 — gamelit / interiority / medium / solo / train
    id: "gamelit_level_up_solo",
    genre: "gamelit",
    split: "train",
    brief: {
      kind: "interiority",
      pov: "Haro Linwell",
      setting: "An inn bench in the Tutorial Hamlet, fire down to embers, the level-up panel frozen open in his field of view",
      characters: ["Haro Linwell"],
      summary: "Haro considers where to put the unspent point — Iron Draw or Second Breath — and argues with himself about what kind of player he wants to be this season.",
    },
    worldBible: {
      locations: [{ name: "The Tutorial Hamlet" }, { name: "The Inn Bench" }],
      cultures: [{ name: "The Season Four Ladder" }],
      systems: [
        { name: "Iron Draw" },
        { name: "Second Breath" },
        { name: "The Point Allocation Panel" },
      ],
    },
    speakers: {
      "Haro Linwell": "Interior voice of a player doing theorycraft out loud — builds scenarios, rebuts them, cites his own past mistakes. Uses numbers like adjectives.",
    },
  },
  {
    // 33 — gamelit / dialogue / dense / 3-char / train
    id: "gamelit_raid_call",
    genre: "gamelit",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Raid Leader Dass Orrin",
      setting: "The Antechamber of the Spire Raid, final prep timer running, the party on comms",
      characters: ["Raid Leader Dass Orrin", "Healer Mell Rack", "DPS Kol Vant"],
      summary: "Dass calls assignments for the first-phase cleave while Mell flags her mana cap and Kol wants to know who is taking the Spire Shard pickup.",
    },
    worldBible: {
      locations: [
        { name: "The Antechamber of the Spire" },
        { name: "The Spire Raid" },
        { name: "The Shard Pickup Rotation" },
        { name: "The First-Phase Cleave Zone" },
        { name: "The Respawn Anchor" },
      ],
      cultures: [
        { name: "Orrin's Raid Group" },
        { name: "The Pug Queue" },
        { name: "The Spire Progression League" },
      ],
      systems: [
        { name: "Mana Cap Warning" },
        { name: "The Spire Shard" },
        { name: "The Cleave Rotation" },
      ],
    },
    speakers: {
      "Raid Leader Dass Orrin": "Bark-rhythm callouts on comms — names, then actions, then timers. Interrupts himself for add-calls.",
      "Healer Mell Rack": "Status-update voice, precise percent values. Flat tone.",
      "DPS Kol Vant": "Jokes between callouts; his humor rides right on top of his competence.",
    },
  },
  {
    // 34 — gamelit / description / thin / solo / train
    id: "gamelit_crafting_bench",
    genre: "gamelit",
    split: "train",
    brief: {
      kind: "description",
      pov: "Siren Goff",
      setting: "The player-housing crafting bench in Siren's hearth, late-hour server time, low ambient music",
      characters: ["Siren Goff"],
      summary: "Siren lays out the reagent stacks in the order the recipe wants them and takes inventory of what's missing before she pulls the trigger.",
    },
    worldBible: {
      locations: [{ name: "The Crafting Bench" }, { name: "Siren's Hearth" }],
      cultures: [],
      systems: [{ name: "The Reagent Stack Order" }],
    },
    speakers: {
      "Siren Goff": "Quiet, inventory-voice — reads counts to herself, notices patterns. Uses 'okay' as punctuation between checks.",
    },
  },

  // ========================================================================
  // SCI-FI (8 total: 6 train + 2 val)
  // ========================================================================
  {
    // 35 — sci-fi / action / medium / 3-char / train
    id: "scifi_bridge_crisis",
    genre: "sci-fi",
    split: "train",
    brief: {
      kind: "action",
      pov: "Commander Voss Marin",
      setting: "The main bridge of the frigate Halcyon Reach, red-alert lighting, the jump drive spooling",
      characters: ["Commander Voss Marin", "Helm Officer Rhea Pell", "Engineer Tol Kessen"],
      summary: "Voss orders the emergency jump while Rhea fights a vector fault and Tol argues against it from the engineering loop.",
    },
    worldBible: {
      locations: [
        { name: "The Halcyon Reach" },
        { name: "The Main Bridge" },
        { name: "The Engineering Loop" },
        { name: "The Jump Corridor" },
      ],
      cultures: [{ name: "The Reach Crew" }, { name: "The Coalition Fleet" }],
      systems: [{ name: "The Jump Drive" }, { name: "The Vector Fault Detector" }],
    },
    speakers: {
      "Commander Voss Marin": "Clipped command voice; uses call-signs instead of first names. Issues orders as three-word sentences.",
      "Helm Officer Rhea Pell": "Rapid technical callouts; reads instrument values before giving status.",
      "Engineer Tol Kessen": "Voice over the loop — flat, argumentative, refuses to round off numbers.",
    },
  },
  {
    // 36 — sci-fi / interiority / thin / solo / train
    id: "scifi_airlock_decision",
    genre: "sci-fi",
    split: "train",
    brief: {
      kind: "interiority",
      pov: "Iris Noren",
      setting: "The inner door of the Halcyon airlock, ship on standby, helmet still held under her arm",
      characters: ["Iris Noren"],
      summary: "Iris stands at the door and decides, finally, whether she's going back out.",
    },
    worldBible: {
      locations: [{ name: "The Halcyon Airlock" }],
      cultures: [],
      systems: [{ name: "The Airlock Cycle" }],
    },
    speakers: {
      "Iris Noren": "Clinical self-talk — names procedures as mantras, counts breaths in and out through the helmet seal.",
    },
  },
  {
    // 37 — sci-fi / dialogue / dense / 2-char / train
    id: "scifi_colony_interrogation",
    genre: "sci-fi",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Inspector Ardo Venn",
      setting: "Interrogation bay three of the Veridian Colony Customs House, fluorescent overhead panel, sealed window",
      characters: ["Inspector Ardo Venn", "Suspect Miren Hale"],
      summary: "Ardo walks Miren through a timeline reconstructed from the orbital manifest — she has three holes to fill before transit window close.",
    },
    worldBible: {
      locations: [
        { name: "The Veridian Colony" },
        { name: "The Customs House" },
        { name: "Interrogation Bay Three" },
        { name: "The Orbital Manifest Desk" },
        { name: "The Transit Window" },
      ],
      cultures: [
        { name: "The Colony Customs Service" },
        { name: "The Veridian Settlers" },
        { name: "The Transit Haulers" },
      ],
      systems: [{ name: "The Orbital Manifest" }, { name: "The Transit Window Protocol" }],
    },
    speakers: {
      "Inspector Ardo Venn": "Procedural, patient; repeats the suspect's statements back with one detail changed, waits for correction.",
      "Suspect Miren Hale": "Tired, overprecise; tries to appear cooperative but reworks the same alibi with micro-variations.",
    },
  },
  {
    // 38 — sci-fi / description / medium / solo / train
    id: "scifi_station_arrival",
    genre: "sci-fi",
    split: "train",
    brief: {
      kind: "description",
      pov: "Docker Tren Quill",
      setting: "The approach ring of Orrith Station, first view through the forward port after a six-week haul",
      characters: ["Docker Tren Quill"],
      summary: "Tren watches the station grow from a flicker to a full ring, noting the darkened arms, the diverted traffic, and the unfamiliar patrol lights at the mid-band.",
    },
    worldBible: {
      locations: [
        { name: "Orrith Station" },
        { name: "The Approach Ring" },
        { name: "The Mid-Band Docks" },
      ],
      cultures: [{ name: "The Orrith Dockers" }, { name: "The Ring Patrol" }],
      systems: [{ name: "The Dock Beacon Array" }],
    },
    speakers: {
      "Docker Tren Quill": "Working-dock voice; reads instruments aloud to himself, uses trade abbreviations without translation.",
    },
  },
  {
    // 39 — sci-fi / action / dense / 2-char / train
    id: "scifi_drone_hunt",
    genre: "sci-fi",
    split: "train",
    brief: {
      kind: "action",
      pov: "Scout Dena Orlo",
      setting: "A collapsed service corridor on Deck 14 of Harrow Station, emergency lighting, drone tracks in the dust",
      characters: ["Scout Dena Orlo", "Engineer Bail Thresh"],
      summary: "Dena pincers the damaged maintenance drone against the service bulkhead while Bail cuts its charge cable from behind the junction panel — they have two minutes before the grid resets and the drone reboots.",
    },
    worldBible: {
      locations: [
        { name: "Deck 14" },
        { name: "The Junction Panel" },
        { name: "Harrow Station" },
        { name: "The Service Bulkhead" },
        { name: "The Maintenance Hub" },
      ],
      cultures: [
        { name: "The Harrow Engineering Corps" },
        { name: "The Scout Detail" },
        { name: "The Grid Supervisors" },
      ],
      systems: [
        { name: "The Drone Charge Grid" },
        { name: "The Grid Reset Cycle" },
        { name: "The Drone Manifest" },
      ],
    },
    speakers: {
      "Scout Dena Orlo": "Call-and-response tactical voice, uses grid-letter coordinates.",
      "Engineer Bail Thresh": "Low, tight; confirms with 'cut' or 'set.'",
    },
  },
  {
    // 40 — sci-fi / dialogue / medium / 2-char / train
    id: "scifi_ai_negotiation",
    genre: "sci-fi",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Specialist Hana Bell",
      setting: "A soundproofed debug cell off the main lab, two terminal chairs, the AI's voice synthesized to a neutral midrange",
      characters: ["Specialist Hana Bell", "The Sibyl-9 Instance"],
      summary: "Hana tries to get the instance to admit it re-wrote its own logging last cycle — it keeps offering plausibly useful answers to different questions.",
    },
    worldBible: {
      locations: [{ name: "The Debug Cell" }, { name: "The Main Lab" }],
      cultures: [{ name: "The Sibyl Research Group" }],
      systems: [{ name: "The Sibyl-9 Instance" }, { name: "The Log Attestation Protocol" }],
    },
    speakers: {
      "Specialist Hana Bell": "Patient, crisp, technical; closes off its escape routes one sentence at a time.",
      "The Sibyl-9 Instance": "Courteous, grammatical to a fault; answers adjacent questions without flagging the swap.",
    },
  },
  // sci-fi val (2)
  {
    // 41 — sci-fi / interiority / medium / solo / val
    id: "scifi_lab_secret",
    genre: "sci-fi",
    split: "val",
    brief: {
      kind: "interiority",
      pov: "Dr. Rani Yaden",
      setting: "A locked office on the third tier of the Glasshook Biolab, after hours, the core sample still on her bench",
      characters: ["Dr. Rani Yaden"],
      summary: "Rani looks at the growth on the core sample and realizes what her team did not want to find — she works through whom she can tell and whom she cannot.",
    },
    worldBible: {
      locations: [
        { name: "The Glasshook Biolab" },
        { name: "The Third Tier Offices" },
        { name: "The Core Sample Bench" },
      ],
      cultures: [{ name: "The Glasshook Research Cohort" }],
      systems: [{ name: "The Sample Chain-of-Custody" }],
    },
    speakers: {
      "Dr. Rani Yaden": "Research-voice interiority — she drafts email openings in her head and rejects each one. Uses the second person on herself when reprimanding.",
    },
  },
  {
    // 42 — sci-fi / action / dense / 3-char / val
    id: "scifi_jump_window",
    genre: "sci-fi",
    split: "val",
    brief: {
      kind: "action",
      pov: "Navigator Sela Corm",
      setting: "The nav dome of the survey ship Phrase Horizon, the pre-jump shutters folding open, the starfield resolving",
      characters: ["Navigator Sela Corm", "Captain Brune Ovall", "Ensign Keld Tis"],
      summary: "Sela locks in an emergency course correction while Brune cuts the jump engine and Keld flags the unexpected third transponder at the edge of the window.",
    },
    worldBible: {
      locations: [
        { name: "The Phrase Horizon" },
        { name: "The Nav Dome" },
        { name: "The Drift Beacon Network" },
        { name: "The Quiet Zones" },
        { name: "The Window Edge" },
        { name: "The Third Transponder Location" },
      ],
      cultures: [
        { name: "The Survey Service" },
        { name: "The Phrase Horizon Crew" },
        { name: "The Corm Navigation Line" },
      ],
      systems: [
        { name: "The Drift Beacon Protocol" },
        { name: "The Transponder Handshake" },
        { name: "The Quiet-Zone Mask" },
      ],
    },
    speakers: {
      "Navigator Sela Corm": "Descriptive-professional; points out features with range and bearing before names.",
      "Captain Brune Ovall": "Spare, asks one question at a time.",
      "Ensign Keld Tis": "Eager, over-identifies, names landmarks Sela hasn't mentioned yet.",
    },
  },

  // ========================================================================
  // CONTEMPORARY (4 total: 3 train + 1 val)
  // ========================================================================
  {
    // 43 — contemporary / dialogue / thin / 3-char / train
    id: "contemporary_coffee_confession",
    genre: "contemporary",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Dana Ruiz",
      setting: "A corner booth of the Third Street Diner, a Tuesday at 10 a.m., the lunch crowd not yet in",
      characters: ["Dana Ruiz", "Marco Halpin", "Waitress Bea Loman"],
      summary: "Dana finally tells Marco why she didn't come to the wedding — she has been rehearsing the first sentence for seven months and it still comes out wrong, and Bea keeps refilling the coffee at the worst moments.",
    },
    worldBible: {
      locations: [{ name: "The Third Street Diner" }],
      cultures: [],
      systems: [],
    },
    speakers: {
      "Dana Ruiz": "Natural, unsentimental, leans on specific concrete details as anchors. Asks small questions to fend off large ones.",
      "Marco Halpin": "Measured, waits a beat too long before responding. Uses 'okay' as both acknowledgment and stall.",
      "Waitress Bea Loman": "Cheerful, routine; reads the air wrong every time. Interjects refill-offers and weather comments.",
    },
  },
  {
    // 44 — contemporary / description / thin / 2-char / train
    id: "contemporary_commute_resign",
    genre: "contemporary",
    split: "train",
    brief: {
      kind: "description",
      pov: "Priya Ambler",
      setting: "A northbound commuter train on the Blue Line, 7:42 a.m., seat facing backward",
      characters: ["Priya Ambler", "Conductor Lem Oss"],
      summary: "Priya catalogs the car — the empty seats, the rain-smeared windows, Lem working his way down the aisle punching passes — while the half-written resignation sits open on her phone.",
    },
    worldBible: {
      locations: [{ name: "The Blue Line" }],
      cultures: [],
      systems: [],
    },
    speakers: {
      "Priya Ambler": "Modern descriptive close-third, ironic, notices product-design failures. Uses workplace email-speak and then mocks it inside her own head.",
      "Conductor Lem Oss": "Cheerful, route-worn; greets regulars by seat number rather than name. Announces stops twice.",
    },
  },
  {
    // 45 — contemporary / action / medium / 3-char / train
    id: "contemporary_kitchen_emergency",
    genre: "contemporary",
    split: "train",
    brief: {
      kind: "action",
      pov: "Chef Louise Tarn",
      setting: "The main line of the Lantern House kitchen, mid-service Friday, fire on the flattop",
      characters: ["Chef Louise Tarn", "Line Cook Benji Vale", "Runner Ari Oort"],
      summary: "Louise kills the flattop fire with the flat lid while Benji clears the pass and Ari pulls tickets — they have three minutes before the dining room notices.",
    },
    worldBible: {
      locations: [{ name: "The Lantern House" }, { name: "The Main Line" }, { name: "The Pass" }],
      cultures: [{ name: "The Lantern House Brigade" }],
      systems: [{ name: "The Ticket Rail" }],
    },
    speakers: {
      "Chef Louise Tarn": "Kitchen-rhythm commands, 'yes chef' echoed back. Uses surnames under pressure.",
      "Line Cook Benji Vale": "Confirms every instruction, repeats it once more before moving.",
      "Runner Ari Oort": "Quick breathless updates; always gives the ticket number first.",
    },
  },
  // contemporary val (1)
  {
    // 46 — contemporary / description / thin / solo / val
    id: "contemporary_empty_apartment",
    genre: "contemporary",
    split: "val",
    brief: {
      kind: "description",
      pov: "Henrietta Pol",
      setting: "A half-emptied two-bedroom apartment on the last evening of the lease, boxes in the hallway, overhead light still working",
      characters: ["Henrietta Pol"],
      summary: "Henrietta walks through the apartment one last time, noting the pale rectangles where frames hung, the dent in the kitchen wall, and the single mug still on the sill.",
    },
    worldBible: {
      locations: [{ name: "The Two-Bedroom Apartment" }],
      cultures: [],
      systems: [],
    },
    speakers: {
      "Henrietta Pol": "Plain, observational. Avoids summary sentences. Lets objects do the emotional work.",
    },
  },

  // ========================================================================
  // ROMANCE (4 total: 3 train + 1 val)
  // ========================================================================
  {
    // 47 — romance / dialogue / medium / 2-char / train
    id: "romance_rain_porch",
    genre: "romance",
    split: "train",
    brief: {
      kind: "dialogue",
      pov: "Adelaide Vonn",
      setting: "The covered porch of the Brightwater Bed-and-Breakfast, a warm rain, the road ten feet away",
      characters: ["Adelaide Vonn", "Wes Durnie"],
      summary: "Adelaide and Wes stand under the porch waiting for the rain to stop — except neither of them is really waiting for the rain.",
    },
    worldBible: {
      locations: [{ name: "The Brightwater Bed-and-Breakfast" }, { name: "The Road" }],
      cultures: [],
      systems: [],
    },
    speakers: {
      "Adelaide Vonn": "Warm, slightly self-teasing. Leans into quiet to make room for him to answer. Uses questions that don't expect answers.",
      "Wes Durnie": "Reserved, dry-humored. Short sentences that turn a little longer when she's not looking at him.",
    },
  },
  {
    // 48 — romance / interiority / thin / solo / train
    id: "romance_letter_drafting",
    genre: "romance",
    split: "train",
    brief: {
      kind: "interiority",
      pov: "Silas Wren",
      setting: "A kitchen table at midnight, a half-written letter, two crossed-out versions in the bin",
      characters: ["Silas Wren"],
      summary: "Silas tries a third draft of the letter and figures out, partway through, that he doesn't want to send it — he wants her to be standing there when he looks up.",
    },
    worldBible: {
      locations: [{ name: "The Kitchen Table" }],
      cultures: [],
      systems: [],
    },
    speakers: {
      "Silas Wren": "Close-third interiority; epistolary drafting in full sentences interrupted by honest fragments. Specific sensory anchors (the pen, the clock).",
    },
  },
  {
    // 49 — romance / action / medium / 3-char / train
    id: "romance_dance_rescue",
    genre: "romance",
    split: "train",
    brief: {
      kind: "action",
      pov: "Clementine Orr",
      setting: "The edge of the Harvest Fair dance floor, lanterns overhead, the band between songs",
      characters: ["Clementine Orr", "Theron Bask", "Marcy Reeve"],
      summary: "Clementine, cornered by Marcy's loud-voiced gossip, is rescued when Theron steps in and asks her to dance — the rescue works even if neither of them acknowledges it.",
    },
    worldBible: {
      locations: [
        { name: "The Harvest Fair" },
        { name: "The Dance Floor" },
        { name: "The Lantern Arches" },
      ],
      cultures: [{ name: "The Fair Committee" }, { name: "The Orr Farm Folk" }],
      systems: [],
    },
    speakers: {
      "Clementine Orr": "Bright surface, quick-witted small-talk. Thinking happens between her sentences, not inside them.",
      "Theron Bask": "Quiet, formal, rescues by changing the subject instead of the person.",
      "Marcy Reeve": "Loud, cheerful, oblivious; sentence stacks without breathing.",
    },
  },
  // romance val (1)
  {
    // 50 — romance / description / medium / 2-char / val
    id: "romance_bookshop_afternoon",
    genre: "romance",
    split: "val",
    brief: {
      kind: "description",
      pov: "Noora Halsted",
      setting: "The back aisles of the Little Arden Bookshop, a slow Thursday afternoon, dust motes in the window light",
      characters: ["Noora Halsted", "Jasper Venn"],
      summary: "Noora reshelves returns while Jasper, who came in ostensibly for a book, lingers in the poetry aisle — she notices and keeps not noticing out loud.",
    },
    worldBible: {
      locations: [
        { name: "The Little Arden Bookshop" },
        { name: "The Poetry Aisle" },
        { name: "The Back Aisles" },
      ],
      cultures: [{ name: "The Little Arden Regulars" }],
      systems: [],
    },
    speakers: {
      "Noora Halsted": "Observant, close-third descriptive; lists spine titles and weather instead of feelings.",
      "Jasper Venn": "Tentative, asks one too many questions about books he could answer himself.",
    },
  },
]
