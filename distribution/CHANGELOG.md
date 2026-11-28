# Release notes

## 0.2.0 — unreleased

- Apply species traits to a character built from a character sheet. A sheet
  binds its species traits as support profiles, and Halfling Luck, Brave,
  Dwarven Resilience's save Advantage, Gnomish Cunning and Goliath Powerful
  Build read only Unit feature bindings, so a sheet-built character lost them.
  They now read either binding.

- Add the Elf's Fey Ancestry, Keen Senses and Trance. Fey Ancestry gives
  Advantage on saves to avoid or end Charmed. Keen Senses is a skill
  proficiency choice of Insight, Perception or Survival. Trance is a new
  `sleepless_trance` species trait shape: a character with it succeeds on
  Sleep's saves automatically, without the table's non-sleeper fact. Its
  4-hour Long Rest is recorded but not yet used by the character sheet.

- Add the Elf's Elven Lineage and the Tiefling's Fiendish Legacy and
  Otherworldly Presence. Both lineage traits use the `species_lineage_choice`
  shape Gnomish Lineage uses, each with its own choice key (`elven_lineage`,
  `fiendish_legacy`), and add character level 3 and 5 spell tiers. The
  lineage spellcasting ability choice key is now
  `species_lineage_spellcasting_ability` (was
  `gnomish_lineage_spellcasting_ability`), and
  `CharacterBuild.speciesChoiceFacts.gnomishLineage` is now `speciesLineage`.
  The character sheet lists each lineage's spells, with one free cast per Long
  Rest for the leveled ones, and Otherworldly Presence's Thaumaturgy. In
  battle, a Fiendish Legacy gives its damage Resistance and a Wood Elf has a
  35-foot Speed. Casting lineage spells in battle is not yet supported.

- Start the battle's opening turn like every other turn, so the first
  participant gets its start-of-turn effects, such as a Death Saving Throw at
  0 Hit Points or Heroic Warrior's Heroic Inspiration. When that start needs a
  roll or choice, the battle opens with Start Turn as its only Act and a
  `turnStart` pending procedure; MCP exposes it as `start_turn`. Hosts that
  admit initial companions use `startBattleWithCompanionRoster`, replacing
  `composeBattleCompanionRoster`; it completes the roster before opening the turn. `finishInitialInitiativeSetup` now returns a `Result`.

- Expose the required spell-area input shape and explicit object facts in Battle
  requests. Retain invalid requests for correction, and add safe cancellation of
  unanswered action selections without reverting committed effects.
- Admit requested reduction dice with named MCP Reaction modifiers while keeping
  other Reactions on their staged input workflow. Clarify checkpoint-based Battle
  narration and map status.
- Preserve bounded tool names and rejection diagnostics through Play Session
  responses without logging arguments, session identifiers, or result prose.

- Rename the MCP character-choice tools to `get_character_creation_choices` and
  `apply_character_creation_choices`; update workflow instructions and display
  names without changing character-creation behavior.

- Support level-7 Barbarian Feral Instinct and Instinctive Pounce through character
  creation and battle handoff. Query selected Initiative Advantage before rolling;
  entering Rage can optionally move half current Speed through ordinary movement,
  Opportunity Attack, and movement-hazard resolution.

- Extend character creation and level gains with source-scoped repeated feat
  choices, College of Lore skill and spell choices, and additional Fighting Style
  selection. Retain the original grant when replacing a Fighting Style.
- Add Bardic Inspiration recovery through Short Rests and Spell Slots, Wizard
  prepared-spell replacement after Short Rests, and Hunter mark knowledge and
  selected attack defenses through the existing sheet and battle APIs.

- Publish the breaking Battle frontier contract: ordinary hole results expose
  the `replaySubject` that must be replayed and a required `pendingProcedure`.
  Turn-boundary procedures identify their ending actor, source turn, and
  requested occurrence, including incoming Death Saving Throw metadata.
- Extend the packed SDK and MCP consumers to exercise the public frontier
  contract through the character and Stat Block battle paths.

## 0.1.3

- Tighten battle lifecycle, attack-outcome, and saving-throw roll-mode
  contracts, including canonical death-save and hit-point transitions, and
  derive multiple D20 selection from its roll mode and faces.
- Harden surface trace IDs, accumulate and finalize dependency traces through a
  typed Result before rendering, and validate MCP character/session projections
  at the public boundaries.

## 0.1.2

- Release the current SDK and MCP packages.

## Unreleased

- Explain the MCP player experience, client setup, and local session limits in
  the package README, and correct the example pin to published version 0.1.1.

## 0.1.1

- Add npm discovery keywords to the SDK and MCP packages.

## 0.1.0 — unreleased

- Package the existing SRD runtime APIs as `@dearlordylord/dnd-sdk`, with ESM
  JavaScript and TypeScript declarations.
- Package the existing stdio server as `@dearlordylord/dnd-mcp` with the
  `dnd-mcp` executable.
- Add isolated packed-consumer verification and a shared-repository release
  command. Existing rule-support limits remain unchanged.
