// UNIT-IDENTITY-EVIDENCE: deterministic-admission-projection SPECIES-ELF-TRAITS species_elf_fey_ancestry
// UNIT-IDENTITY-EVIDENCE: deterministic-admission-projection SPECIES-ELF-TRAITS species_elf_trance
import { savingThrowTargetModifiers } from "../../battle-runtime/src/battle-reducer/saving-throw-modifier-collector.ts";
import { statBlockId, unitId } from "@dnd/shared/game-facts";
import { combatantId, resolveBattleSubject } from "@dnd/battle-runtime";
import {
  characterBuildUnitRefs,
  classUnitId,
  creationChoiceOptionId,
  finalizeCharacterDraft,
} from "@dnd/character-creation-runtime";
import { completeSupportedProgressionDraft } from "@dnd/character-creation-runtime/test-support";
import { describe, expect, test } from "vitest";
import {
  battleSessionFromSheets,
  characterSheet,
  levelFiveWizardBuild,
  monsterBattleInput,
  requireCombatant,
  requireHoleFromList,
  requireResolved,
  spellSlotActForProcedure,
  srdStatBlock,
  unitLibrary,
} from "./sdk-integration.test-support.ts";

const elfId = combatantId("combatant:elf-traits");

/** A real-catalog Fighter 1 of `species`, its Keen Senses skill Survival. */
function fighterBuild(species: "species_elf" | "species_orc") {
  const draft = completeSupportedProgressionDraft({
    draftId: `draft:elf-traits-${species}`,
    unitLibrary,
    speciesUnitId: unitId(species),
    progression: {
      startingClass: classUnitId(unitId("class_fighter")),
      advancements: [],
    },
    fixtureOptionIds: (source) =>
      source.choiceKey === "species_trait_proficiency_choice"
        ? [creationChoiceOptionId("survival")]
        : undefined,
  });
  const result = finalizeCharacterDraft({ draft, unitLibrary });
  if (result.tag !== "ready")
    throw new Error(`Fighter creation: ${result.tag}`);
  return result.build;
}

function charmedSaveRollModes(species: "species_elf" | "species_orc") {
  const session = battleSessionFromSheets({
    battleIdText: `battle:elf-traits-${species}`,
    characters: [
      characterSheet({
        characterIdText: `character:elf-traits-${species}`,
        combatantId: elfId,
        build: fighterBuild(species),
        initiative: 20,
      }),
    ],
    monsters: [
      monsterBattleInput(
        combatantId("opponent"),
        10,
        srdStatBlock(statBlockId("stat_block_skeleton")),
      ),
    ],
  });
  return {
    charmed: savingThrowTargetModifiers(
      session.state,
      { ability: "wis", avoidsCondition: "charmed" },
      "everyCombatant",
    ).targetRollModes,
    frightened: savingThrowTargetModifiers(
      session.state,
      { ability: "wis", avoidsCondition: "frightened" },
      "everyCombatant",
    ).targetRollModes,
  };
}

const wizardId = combatantId("combatant:sleep-caster");
const orcId = combatantId("combatant:orc-sleeper");

/** A Wizard's Sleep cast on an Elf and an Orc built from sheets. */
function sleepOnElfAndOrc() {
  const session = battleSessionFromSheets({
    battleIdText: "battle:elf-trance-sleep",
    characters: [
      characterSheet({
        characterIdText: "character:sleep-caster",
        combatantId: wizardId,
        build: levelFiveWizardBuild({ preparedSpells: [unitId("sleep")] }),
        initiative: 20,
      }),
      characterSheet({
        characterIdText: "character:elf-trance",
        combatantId: elfId,
        build: fighterBuild("species_elf"),
        initiative: 10,
      }),
      characterSheet({
        characterIdText: "character:orc-sleeper",
        combatantId: orcId,
        build: fighterBuild("species_orc"),
        initiative: 5,
      }),
    ],
    monsters: [],
  });
  const act = spellSlotActForProcedure(
    session,
    "sleep",
    1,
    "stagedSaveCondition",
  );
  const hole = requireHoleFromList(act.initialHoles, "savingThrowOutcome");
  return (
    outcomeTargetIds: readonly (typeof elfId)[],
  ): ReturnType<typeof resolveBattleSubject> =>
    resolveBattleSubject({
      state: session.state,
      subject: act.subject,
      fills: [
        {
          kind: "savingThrowOutcome",
          holeId: hole.holeId,
          value: {
            area: {
              originAnchorId: wizardId,
              affectedTargetIds: [elfId, orcId],
            },
            outcomes: outcomeTargetIds.map((targetId) => ({
              targetId,
              succeeded: false,
              withoutRoll: true as const,
            })),
          },
        },
      ],
    });
}

describe("Elf species traits real-catalog SDK handoff", () => {
  test("an Elf's Keen Senses skill choice becomes a proficiency of the build", () => {
    const build = fighterBuild("species_elf");
    expect(build.proficiencyChoices).toContainEqual({
      kind: "skill",
      skill: "survival",
    });
    expect(
      characterBuildUnitRefs(build, unitLibrary).map((ref) => ref.unitId),
    ).toEqual(
      expect.arrayContaining([
        "species_elf_fey_ancestry",
        "species_elf_keen_senses",
      ]),
    );
  });

  test("an Elf built from a sheet has Advantage on saves against Charmed, and only those", () => {
    expect(charmedSaveRollModes("species_elf")).toEqual({
      charmed: [{ targetId: elfId, rollMode: "advantage" }],
      frightened: [],
    });
  });

  test("an Orc from the same sheet has no Charmed save Advantage", () => {
    expect(charmedSaveRollModes("species_orc")).toEqual({
      charmed: [],
      frightened: [],
    });
  });

  test("Trance makes an Elf from a sheet succeed on Sleep's save without a roll", () => {
    const castSleep = sleepOnElfAndOrc();
    const resolved = requireResolved(castSleep([orcId])).state;
    expect(
      requireCombatant(resolved, elfId).conditions.directIncapacitated,
    ).toBe(false);
    expect(
      requireCombatant(resolved, orcId).conditions.directIncapacitated,
    ).toBe(true);
    expect(castSleep([elfId, orcId])).toMatchObject({
      tag: "invalid",
      message: expect.stringContaining("automatically succeed"),
    });
  });
});
