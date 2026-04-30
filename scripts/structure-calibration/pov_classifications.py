"""
Pattern 52 — POV classifications for Salvatore Icewind Dale corpus.

Classification rules used:
  - "Dominant POV" = the character whose consciousness anchors the largest fraction
    of the chapter's scenes (or, when all scenes are equally weighted, the character
    most central to the chapter's events).
  - "multi_pov: True" if the chapter contains 2+ scenes anchored to clearly different
    POV characters (cross-fellowship or fellowship-vs-villain). Internal jumps
    within the same fellowship in a single shared scene do NOT count.
  - "external_omniscient" used when the scene narrator floats above named characters
    (battle overviews, geographic establishing shots).
  - Villain-focal chapters/scenes labeled by villain name when consciousness is
    clearly anchored (Akar Kessell, Errtu, Entreri, Dendybar, Pasha Pook, etc.).

Format:
  CLASSIFICATIONS[(book, ch)] = {
      "pov": "<modal-pov-label>",
      "multi_pov": True/False,
      "secondary_pov": ["<other>", ...] or None,
      "rationale": "short note"
  }
"""

CLASSIFICATIONS = {

    # =========================================================================
    # CRYSTAL SHARD (book 1)
    # =========================================================================

    ("crystal_shard", "prelude"): {
        "pov": "errtu",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient"],
        "rationale": "Scene 0 anchored to Errtu the demon (drumming fingers, hissing); scene 1 is external/omniscient narrator describing Crenshinibon settling into snow."
    },
    ("crystal_shard", "1"): {
        "pov": "akar_kessell",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "eldeluc"],
        "rationale": "Scene 0 external narrator describes wizards' caravan approach. Scenes 1-3 anchor strongly to Kessell (his betrayal of Morkai, his daydreams, his boots/mind/face). Scene 2 partially anchored to the wizard plotters (Eldeluc/Dendybar) too."
    },
    ("crystal_shard", "2"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["regis"],
        "rationale": "Scene 0 anchored to Regis (his fishing, his memory of Pasha Pook). Scene 1 anchored to Drizzt (his soft boots, his vulnerability in sunlight, his interiority). Scenes 2-3 yeti fight has Drizzt as anchor."
    },
    ("crystal_shard", "3"): {
        "pov": "external_omniscient",
        "multi_pov": True,
        "secondary_pov": ["heafstaag", "beorg"],
        "rationale": "Geographical establishing scene (omniscient), then scenes anchor to barbarian kings Heafstaag and Beorg. No fellowship POV; fully villain/antagonist-focal."
    },
    ("crystal_shard", "4"): {
        "pov": "akar_kessell",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "All 5 scenes anchor to Kessell (his unconsciousness, his crystal-shard discovery, his ascendance with the tribe). Single-POV villain chapter."
    },
    ("crystal_shard", "5"): {
        "pov": "bruenor",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter, anchored to Bruenor on his Climb (his memories of Mithril Hall, his interiority about his clan)."
    },
    ("crystal_shard", "6"): {
        "pov": "regis",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter, anchored to Regis (his Bryn Shander walk, his memories of Calimport, his negotiations)."
    },
    ("crystal_shard", "7"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "guenhwyvar", "bruenor"],
        "rationale": "Scene 0 omniscient (barbarian charge). Scenes 1-2 Drizzt scouting. Scene 3 brief Guenhwyvar astral cameo. Scene 4 Bruenor speaking. Drizzt is dominant."
    },
    ("crystal_shard", "8"): {
        "pov": "external_omniscient",
        "multi_pov": True,
        "secondary_pov": ["debernezan", "bruenor", "heafstaag", "drizzt", "kemp"],
        "rationale": "Major battle chapter. Scenes anchor variously to deBernezan, Heafstaag, Bruenor, Drizzt, Kemp finding Drizzt's body. No single dominant POV — battle-omniscient with multiple anchors."
    },
    ("crystal_shard", "9"): {
        "pov": "regis",
        "multi_pov": True,
        "secondary_pov": ["bruenor"],
        "rationale": "Scene 0 anchored to Regis (lazy fishing). Scene 1 shifts to Bruenor smithing — his huge muscled arm in the forge. Two-POV chapter."
    },
    ("crystal_shard", "10"): {
        "pov": "akar_kessell",
        "multi_pov": True,
        "secondary_pov": ["errtu", "external_omniscient"],
        "rationale": "Scenes anchor to orcs-meeting-Kessell, Kessell's swelling ranks, Errtu sensing Kessell's power, Kessell ascendant. Villain-focal multi-anchor."
    },
    ("crystal_shard", "11"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient"],
        "rationale": "Scenes 0-2 anchor to Bruenor (his sweat on key, his forge construction, his crafting dream). Scene 3 a brief external owl/rabbit sentinel image."
    },
    ("crystal_shard", "12"): {
        "pov": "wulfgar",
        "multi_pov": True,
        "secondary_pov": ["drizzt", "bruenor"],
        "rationale": "Scene 0 Wulfgar w/ Catti-brie. Scene 1 Drizzt's vigil over unconscious Bruenor. Scene 2 Bruenor pounding/forging Aegis-fang. Three-anchor chapter, Wulfgar opens."
    },
    ("crystal_shard", "13"): {
        "pov": "akar_kessell",
        "multi_pov": True,
        "secondary_pov": ["heafstaag", "errtu"],
        "rationale": "Scene 0 Kessell instructing Biggrin. Scene 1 Heafstaag entering tower (his hate, his stature). Errtu present as commenter. Villain-anchored."
    },
    ("crystal_shard", "14"): {
        "pov": "wulfgar",
        "multi_pov": True,
        "secondary_pov": ["bruenor", "drizzt"],
        "rationale": "Scene 0 Bruenor calling on Wulfgar (Bruenor anchor). Scene 1 Wulfgar viewing Icewind Dale. Scenes 2-3 Wulfgar/Drizzt. Wulfgar dominant."
    },
    ("crystal_shard", "15"): {
        "pov": "external_omniscient",
        "multi_pov": True,
        "secondary_pov": ["biggrin", "drizzt", "akar_kessell"],
        "rationale": "Scene 0 verbeeg infiltration omniscient. Scene 1 Biggrin's giant-leader anchor. Scene 2 Drizzt waking. Scene 4 Kessell waiting. True multi-POV."
    },
    ("crystal_shard", "16"): {
        "pov": "wulfgar",
        "multi_pov": True,
        "secondary_pov": ["drizzt"],
        "rationale": "Scenes 0+2 anchor to Wulfgar (his awakening, his all-night run). Scene 1 Drizzt's interiority about the warhammer. Wulfgar dominant."
    },
    ("crystal_shard", "17"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["bruenor", "guenhwyvar"],
        "rationale": "Scene 0 Bruenor & dwarves marching. Scenes 1-3 Drizzt+Wulfgar scouting/ambushing. Scene 4 Guenhwyvar attack. Drizzt-Wulfgar pair dominates."
    },
    ("crystal_shard", "18"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["wulfgar", "guenhwyvar"],
        "rationale": "Drizzt+Wulfgar storm verbeeg lair across multiple scenes. Scene 7 panther chase. Drizzt dominant; Wulfgar shares heavily."
    },
    ("crystal_shard", "19"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["wulfgar", "bruenor"],
        "rationale": "Scenes 0-1 Drizzt in tunnels with Wulfgar. Scenes 2-3 council with Bruenor. Drizzt dominant."
    },
    ("crystal_shard", "20"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["drizzt", "regis", "akar_kessell"],
        "rationale": "Scene 0 Bruenor declaring mine-block. Scene 1 omniscient/Cassius. Scene 2 Regis. Scene 3 Kessell on his throne. True multi-POV."
    },
    ("crystal_shard", "21"): {
        "pov": "wulfgar",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "icingdeath"],
        "rationale": "Scene 0 establishing shot Evermelt (omniscient). Scene 1 Wulfgar approach. Scene 2 dragon Icingdeath asleep. Wulfgar dominant — his Aegis-fang throw, his perception."
    },
    ("crystal_shard", "22"): {
        "pov": "wulfgar",
        "multi_pov": True,
        "secondary_pov": ["drizzt", "heafstaag"],
        "rationale": "Wulfgar regains consciousness (s0), discusses escape (s1), pondering at tribes (s2-3), Heafstaag axe (s4), Drizzt running (s5). Wulfgar dominant."
    },
    ("crystal_shard", "23"): {
        "pov": "external_omniscient",
        "multi_pov": True,
        "secondary_pov": ["regis", "schermont"],
        "rationale": "Battle-omniscient scenes (Caer-Dineval fleet, Bryn Shander wall view, dwarves in mines, goblin generals). Regis briefly anchors at the wall. No single fellowship POV dominant."
    },
    ("crystal_shard", "24"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "regis", "kemp"],
        "rationale": "Drizzt witnesses & follows Errtu (scenes 0-1). Scene 2 ships easthaven. Scene 3 Regis on wall. Scene 4 Kemp on water. Drizzt dominant via his demon-tracking."
    },
    ("crystal_shard", "25"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["errtu"],
        "rationale": "Drizzt's preparation to confront Errtu (s0-1). Scene 2 Errtu in Kessell's harem. Drizzt dominant."
    },
    ("crystal_shard", "26"): {
        "pov": "wulfgar",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter — Wulfgar at Mead Hall after taking the barbarian crown. His tactical reasoning."
    },
    ("crystal_shard", "27"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "bruenor"],
        "rationale": "Scene 0 Bremen's destruction omniscient. Scene 1 Bruenor's clan. Scene 2 Cassius council. Scene 3 Drizzt under demon shadow — Drizzt's POV is the dramatic anchor."
    },
    ("crystal_shard", "28"): {
        "pov": "regis",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "drizzt", "kemp"],
        "rationale": "Scene 0 Regis in Cryshal-Tirith with Kessell. Scene 1 Kemp on water. Scene 2 Drizzt witnessing army shift. Scene 3 Drizzt entering tower. Three-anchor chapter; Regis opens."
    },
    ("crystal_shard", "29"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["drizzt"],
        "rationale": "Scene 0 Bruenor leading dwarven counter-attack. Scene 1 Drizzt fighting trolls in Cryshal-Tirith. True dual-POV."
    },
    ("crystal_shard", "30"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["regis", "wulfgar", "external_omniscient", "cassius", "kemp"],
        "rationale": "Climax chapter, 16 scenes. Drizzt's tower-destruction is dramatic core (s2, s10, s12, s14, s15). Regis fight Errtu (s1). Wulfgar's barbarian charge (s11). Battle-omniscient throughout. Drizzt dominant."
    },
    ("crystal_shard", "epilogue"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["akar_kessell"],
        "rationale": "Scene 0 Bruenor sparing the young barbarian. Scene 1 Kessell glimpsing smoke from his stolen pleasure-tower."
    },
    ("crystal_shard", "epilogue2"): {
        "pov": "wulfgar",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-POV — Wulfgar running across the tundra to find his tribes."
    },
    ("crystal_shard", "epilogue3"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "wulfgar", "catti-brie", "bruenor", "regis"],
        "rationale": "Six scenes spanning winter aftermath. Scene 1 Drizzt+Bruenor preparing search. Scene 2 Catti-brie/Wulfgar. Scenes 3-5 Drizzt-Bruenor (and Regis joining) departure. Drizzt dominant."
    },

    # =========================================================================
    # STREAMS OF SILVER (book 2)
    # =========================================================================

    ("streams_of_silver", "prelude"): {
        "pov": "shimmergloom",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient"],
        "rationale": "Scene 0 anchored to dragon Shimmergloom on dark throne. Scene 1 the four friends external/omniscient view of journey. Scene 2 continuing fellowship travel."
    },
    ("streams_of_silver", "part1"): {
        "pov": "drizzt",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Drizzt's first-person interlude essay ('I pray that the world never runs out of dragons') — Salvatore's distinctive Drizzt-monologue interludes."
    },
    ("streams_of_silver", "part2"): {
        "pov": "drizzt",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Drizzt first-person 'Allies' interlude — about Bruenor's quest, narrated by Drizzt."
    },
    ("streams_of_silver", "part3"): {
        "pov": "drizzt",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Drizzt first-person interlude — 'In my travels on the surface...' — about the Gondsman and faith."
    },
    ("streams_of_silver", "1"): {
        "pov": "entreri",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter, anchored to Entreri the assassin (his shadows, his prey, his memories of Pasha Pook hunt)."
    },
    ("streams_of_silver", "2"): {
        "pov": "wulfgar",
        "multi_pov": True,
        "secondary_pov": ["bruenor", "external_omniscient"],
        "rationale": "Scene 0 Wulfgar viewing Luskan with Bruenor (his admiration). Scene 1 omniscient establishing shot of Cutlass tavern."
    },
    ("streams_of_silver", "3"): {
        "pov": "regis",
        "multi_pov": True,
        "secondary_pov": ["bruenor", "wulfgar"],
        "rationale": "Scenes 0+2 Regis (his halfling caution, his fears). Scenes 1+3 Bruenor (his composure with Whisper). Mixed fellowship POV."
    },
    ("streams_of_silver", "4"): {
        "pov": "catti-brie",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient"],
        "rationale": "Scene 0 establishing Hosttower (omniscient/architectural). Scene 1 Catti-brie — her red-brown locks, her pursuit thoughts, her concerns about Entreri. Catti-brie's first major chapter."
    },
    ("streams_of_silver", "5"): {
        "pov": "drizzt",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter — Drizzt leading the four companions along Mirar river."
    },
    ("streams_of_silver", "6"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["wulfgar"],
        "rationale": "Scenes 0-1+3 Drizzt's perspective on barbarian raid + tracking + Bruenor's broken helm. Scene 2 Wulfgar meeting Revjak."
    },
    ("streams_of_silver", "7"): {
        "pov": "entreri",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter, all anchored to Entreri (his hill camp, his caravan ambush plan). Catti-brie present but Entreri-focal."
    },
    ("streams_of_silver", "8"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["bruenor"],
        "rationale": "Scenes 0-1 fellowship riding from Longsaddle. Drizzt's chuckle, Drizzt's thoughts about Longsaddle. Bruenor and others ride along."
    },
    ("streams_of_silver", "9"): {
        "pov": "external_omniscient",
        "multi_pov": True,
        "secondary_pov": ["jierdan", "dendybar", "sydney"],
        "rationale": "Antagonist-focal chapter. Scene 0 Nightkeeper/Jierdan exterior watch. Scenes 1-3 Dendybar/Sydney plotting. No fellowship POV."
    },
    ("streams_of_silver", "10"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["wulfgar", "regis", "dendybar"],
        "rationale": "Scenes 0-1 fellowship traveling — Drizzt's cowl, Wulfgar's recovery. Scene 2 Dendybar dismissing specter. Drizzt dominant fellowship anchor."
    },
    ("streams_of_silver", "11"): {
        "pov": "entreri",
        "multi_pov": True,
        "secondary_pov": ["sydney"],
        "rationale": "Entreri-Sydney antagonist chapter. Scenes 0-1 their conjured-mount ride and Uthgardt encounter. Scene 2 Entreri continuing pursuit."
    },
    ("streams_of_silver", "12"): {
        "pov": "wulfgar",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "regis"],
        "rationale": "Scene 0 omniscient bog establishing. Scene 1 the troll-bog denizen omniscient. Scene 2 Regis. Scene 3 Wulfgar fighting troll. Wulfgar dominant in action."
    },
    ("streams_of_silver", "13"): {
        "pov": "regis",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter, opening anchored to Regis in the dark log/bog. Bruenor speaks but Regis is the consciousness anchor."
    },
    ("streams_of_silver", "14"): {
        "pov": "drizzt",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter, anchored to Drizzt examining Wulfgar's troll-hand wound. Drizzt's eyes widen, Drizzt prods with burning stick."
    },
    ("streams_of_silver", "15"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["entreri", "sydney"],
        "rationale": "Scene 0 Drizzt's information from a stranger. Scene 1 Entreri pacing room with Sydney. Scenes 2-3 Sydney and golem. Mixed fellowship-villain."
    },
    ("streams_of_silver", "16"): {
        "pov": "drizzt",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter at Herald's Holdfast — Drizzt's perception (he is sure, he feels age of tower). Bruenor and Regis ask, but Drizzt anchors."
    },
    ("streams_of_silver", "17"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["drizzt"],
        "rationale": "Scenes 0-1 anchored to Bruenor returning to Mithral Hall — his obsession, his recognition of Dwarvendarrow. Scene 2 mostly Bok/golem tracking."
    },
    ("streams_of_silver", "18"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["entreri"],
        "rationale": "Scene 0 Bruenor at Keeper's Dale. Scene 1 Entreri tracking. Scene 2 fellowship search."
    },
    ("streams_of_silver", "19"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["dendybar", "entreri"],
        "rationale": "Scene 0 Bruenor mapping Garumn's Gorge. Scene 1 Dendybar commanding specter. Scenes 2-4 Entreri/Sydney. Multi-anchor."
    },
    ("streams_of_silver", "20"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["sydney"],
        "rationale": "Scene 0 Bruenor mourning Drizzt. Scenes 1+3 Sydney/Bok pursuing. Scene 2 fellowship caverns. Bruenor's grief is dominant emotional anchor."
    },
    ("streams_of_silver", "21"): {
        "pov": "drizzt",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter — Drizzt regaining consciousness with Entreri above. His startled awareness, his concentration."
    },
    ("streams_of_silver", "22"): {
        "pov": "wulfgar",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "regis", "bruenor"],
        "rationale": "Scene 0 Shimmergloom in mithral chamber (omniscient/dragon). Scenes 1-3 Wulfgar fighting through tunnels. Scenes 4-5 Regis/Bruenor. Wulfgar action-dominant."
    },
    ("streams_of_silver", "23"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["bruenor", "entreri"],
        "rationale": "Scenes 0-1 dragon emerging, Drizzt+Entreri pinned. Scene 3 Bruenor's keg-leap (the famous moment). Scenes 2+4-5 Drizzt. Bruenor's leap is iconic but Drizzt anchors more scenes."
    },
    ("streams_of_silver", "24"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["catti-brie", "wulfgar"],
        "rationale": "Scene 0 Drizzt rejoining Catti-brie+Wulfgar atop gorge. Scene 1 fellowship escape. Drizzt dominant."
    },
    ("streams_of_silver", "epilogue"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["dendybar"],
        "rationale": "Scene 0 Drizzt+Wulfgar+Catti-brie at Longsaddle. Scene 1 Dendybar's failure-discovery. Antagonist coda."
    },

    # =========================================================================
    # HALFLINGS GEM (book 3)
    # =========================================================================

    ("halflings_gem", "prelude"): {
        "pov": "external_omniscient",
        "multi_pov": True,
        "secondary_pov": ["guenhwyvar"],
        "rationale": "Scene 0 a Wizard (Malchor?) looking down on Catti-brie — external/wizard-anchored. Scene 1 Guenhwyvar pacing on astral plane. No fellowship-POV."
    },
    ("halflings_gem", "1"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["wulfgar", "malchor"],
        "rationale": "Six scenes at Malchor's tower. Drizzt's lavender eyes, Drizzt's responses dominate. Wulfgar's grumbles also anchor. Scene 5 Malchor in his hidden dimension."
    },
    ("halflings_gem", "2"): {
        "pov": "entreri",
        "multi_pov": True,
        "secondary_pov": ["regis"],
        "rationale": "Scenes 0-1 Entreri mesmerized by ruby pendant. Scenes 2-3 Regis on the deck. True duel of consciousness — Entreri opens and dominates."
    },
    ("halflings_gem", "3"): {
        "pov": "wulfgar",
        "multi_pov": True,
        "secondary_pov": ["drizzt", "external_omniscient"],
        "rationale": "Scenes 0+2-3 Wulfgar+Drizzt at Conyberry/Agatha encounter. Wulfgar's words anchor s0. Drizzt's explanations anchor s2. Mixed-pair, Wulfgar opens."
    },
    ("halflings_gem", "4"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["wulfgar", "deudermont"],
        "rationale": "Drizzt+Wulfgar arrive Waterdeep, find Captain Deudermont. Drizzt asks/observes mostly. Bungo bar fight features Wulfgar."
    },
    ("halflings_gem", "5"): {
        "pov": "bruenor",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter — Bruenor in disguise with mithril axe in duergar tunnels. Single-POV anchored to Bruenor's escape."
    },
    ("halflings_gem", "6"): {
        "pov": "regis",
        "multi_pov": True,
        "secondary_pov": ["entreri"],
        "rationale": "Seven scenes — sailor mob, Regis's memories, Baldur's Gate. Regis dominant; Entreri features in scenes 3-5 of Baldur's Gate."
    },
    ("halflings_gem", "7"): {
        "pov": "bruenor",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Four scenes all anchored to Bruenor — recovery from chimney, Harkle's Hill, watching the western sky. Single-POV."
    },
    ("halflings_gem", "8"): {
        "pov": "pasha_pook",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene chapter establishing Calimport thieves' guild. Pook's chambers, Pook's pacing. Villain-focal single-POV."
    },
    ("halflings_gem", "9"): {
        "pov": "external_omniscient",
        "multi_pov": True,
        "secondary_pov": ["oberon", "entreri", "drizzt", "pasha_pook"],
        "rationale": "Six scenes scrying-themed: Oberon, Entreri, Drizzt+Wulfgar, Pook. No single fellowship POV dominates; Oberon and the scrying-network anchor much."
    },
    ("halflings_gem", "10"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "alustriel", "catti-brie"],
        "rationale": "Scene 0 nightmare image (Regis suspended). Scenes 1-2+4 Bruenor — his sweat, his nightmare, his meeting Alustriel. Catti-brie joins. Bruenor dominant."
    },
    ("halflings_gem", "11"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "pinochet", "bruenor", "catti-brie", "wulfgar"],
        "rationale": "Fifteen scenes — Sea Sprite vs pirates, Bruenor+Catti-brie chariot rescue, Wulfgar attacks. Drizzt-Deudermont dialogue anchors opening. Many anchors; Drizzt slightly dominant."
    },
    ("halflings_gem", "12"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["drizzt"],
        "rationale": "Reunion chapter. Scene 0 Bruenor finds Catti-brie in water. Scene 1 Drizzt boarding back. Scene 2 the friends sharing stories."
    },
    ("halflings_gem", "13"): {
        "pov": "external_omniscient",
        "multi_pov": True,
        "secondary_pov": ["entreri", "regis"],
        "rationale": "Scene 0 omniscient Calimport establishing. Scene 1 Entreri returning to Pook's throne. Scene 2 Cells of Nine (Regis trapped). Mixed villain/captive POV."
    },
    ("halflings_gem", "14"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient"],
        "rationale": "Scene 0 omniscient Sea Sprite repair. Scene 1 four friends at Memnon — Drizzt's amazement anchors the entry."
    },
    ("halflings_gem", "15"): {
        "pov": "regis",
        "multi_pov": True,
        "secondary_pov": ["pasha_pook", "bruenor"],
        "rationale": "Scene 0 Pook torturing Regis (Regis-anchored — his stupid smile). Scene 1 Bruenor's emergence in Memnon market. Scene 2 desert march."
    },
    ("halflings_gem", "16"): {
        "pov": "entreri",
        "multi_pov": True,
        "secondary_pov": ["drizzt", "external_omniscient"],
        "rationale": "Scene 0 Entreri returning home to Calimport — his shadows, his reputation. Scenes 1-3 fellowship arrival, Drizzt's reconnaissance."
    },
    ("halflings_gem", "17"): {
        "pov": "pasha_pook",
        "multi_pov": True,
        "secondary_pov": ["regis", "rassiter"],
        "rationale": "Scene 0 LaValle gifting Guenhwyvar statuette to Pook. Scene 1 Pook teasing Regis (Regis-anchored). Scene 2 Rassiter assignment. Pook is the villain-spine."
    },
    ("halflings_gem", "18"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["dondon", "bruenor"],
        "rationale": "Scene 0 Dondon (wererat halfling). Scenes 1+ Drizzt leading sewer descent. Drizzt anchors most action; Dondon antagonist."
    },
    ("halflings_gem", "19"): {
        "pov": "wulfgar",
        "multi_pov": True,
        "secondary_pov": ["drizzt", "entreri", "rassiter", "bruenor"],
        "rationale": "Eight scenes interleaving Wulfgar's portcullis fight, Drizzt vs Entreri duel, Rassiter pursuit, Bruenor calling. Wulfgar opens; multi-anchor combat chapter."
    },
    ("halflings_gem", "20"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["wulfgar", "bruenor", "entreri"],
        "rationale": "Drizzt-Entreri duel continues across multiple scenes. Wulfgar's exhaustion + arm wound. Bruenor+Catti-brie tracking. Multi-anchor combat."
    },
    ("halflings_gem", "21"): {
        "pov": "wulfgar",
        "multi_pov": True,
        "secondary_pov": ["bruenor", "regis", "pasha_pook"],
        "rationale": "Wulfgar dodging wererats (scenes 0+2). Bruenor charging the door (s1). Pook watching via Hoop (s3). Regis horror (s5). Multi-anchor."
    },
    ("halflings_gem", "22"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "lavalle", "guenhwyvar"],
        "rationale": "Tarterus-plane chapter. Scene 0 four friends in Tarterus (omniscient establish + Drizzt-led). Scene 1 LaValle on the mirror. Scenes 2-4 Drizzt-led Tarterus combat."
    },
    ("halflings_gem", "23"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["drizzt", "wulfgar", "lavalle", "regis"],
        "rationale": "Scene 0 Bruenor smashing into Pook's chamber. Scenes 1+4 Wulfgar at Taros Hoop. Scenes 2+5 Drizzt rescuing Catti-brie. Multi-anchor climax-adjacent."
    },
    ("halflings_gem", "24"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["drizzt", "wulfgar", "rassiter"],
        "rationale": "Scene 0 Bruenor headbutting eunuch. Scenes 1-2 Drizzt+Wulfgar. Scenes 3-5 fight aftermath. Scene 6 Rassiter's flight."
    },
    ("halflings_gem", "25"): {
        "pov": "bruenor",
        "multi_pov": True,
        "secondary_pov": ["drizzt"],
        "rationale": "Scenes 0+2-3 Bruenor knocking on Drizzt's then wizard's door. Scene 1 Drizzt at his window. Bruenor anchors more, Drizzt key emotional anchor."
    },
    ("halflings_gem", "epilogue"): {
        "pov": "drizzt",
        "multi_pov": False,
        "secondary_pov": None,
        "rationale": "Single-scene Sea Sprite homeward — Drizzt-Deudermont dialogue. Wulfgar shown but Drizzt observes."
    },
    ("halflings_gem", "epilogue2"): {
        "pov": "entreri",
        "multi_pov": True,
        "secondary_pov": ["guenhwyvar", "external_omniscient"],
        "rationale": "Scene 0 Entreri stalking the staircase. Scene 1 Guenhwyvar on astral plane. Scene 2 wizard with statuette. Entreri opens, antagonist coda."
    },
    ("halflings_gem", "epilogue3"): {
        "pov": "drizzt",
        "multi_pov": True,
        "secondary_pov": ["external_omniscient", "bruenor", "catti-brie"],
        "rationale": "Coda: Sea Sprite up coast (omniscient), Bruenor leading Mithral Hall reclamation, Drizzt looking down on Silverymoon, autumn trade. Drizzt's reflective gaze closes the trilogy."
    },
}
