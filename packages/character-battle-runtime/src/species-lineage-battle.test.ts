// UNIT-IDENTITY-EVIDENCE: deterministic-admission-projection SPECIES-LINEAGES species_tiefling_fiendish_legacy
// UNIT-IDENTITY-EVIDENCE: deterministic-admission-projection SPECIES-LINEAGES species_elf_elven_lineage
// UNIT-PROFILE-COVERAGE: verification-owner:runtime-test unit-feature.passive-damage-resistance
import {
  PASSIVE_DAMAGE_RESISTANCE_SUPPORT_PROFILE,
  battleId,
  characterId,
  combatantId,
  initiativeScore,
  snapshotBattle,
  startBattle,
} from "@dnd/battle-runtime";
import {
  ELVEN_LINEAGE_CHOICE_KEY,
  FIENDISH_LEGACY_CHOICE_KEY,
  classUnitId,
  creationChoiceOptionId,
  finalizeCharacterDraft,
} from "@dnd/character-creation-runtime";
import { completeSupportedProgressionDraft } from "@dnd/character-creation-runtime/test-support";
import { unitId } from "@dnd/shared/game-facts";
import { describe, expect, test } from "vitest";
import {
  battleCreatureInitFromCharacterBuild,
  characterBattleSupportProjection,
} from "./index.ts";
import { requireResultSuccess as expectSuccess } from "./result.test-support.ts";
import { unitLibrary } from "./sdk-integration.test-support.ts";

/** A real-catalog Fighter 1 of `species` whose lineage choice is `lineageId`. */
function fighterBuild(
  species: "species_elf" | "species_tiefling",
  lineageId: string,
) {
  const draft = completeSupportedProgressionDraft({
    draftId: `draft:lineage-${species}-${lineageId}`,
    unitLibrary,
    speciesUnitId: unitId(species),
    progression: {
      startingClass: classUnitId(unitId("class_fighter")),
      advancements: [],
    },
    fixtureOptionIds: (source) =>
      source.choiceKey === ELVEN_LINEAGE_CHOICE_KEY ||
      source.choiceKey === FIENDISH_LEGACY_CHOICE_KEY
        ? [creationChoiceOptionId(lineageId)]
        : undefined,
  });
  const result = finalizeCharacterDraft({ draft, unitLibrary });
  if (result.tag !== "ready")
    throw new Error(`Fighter creation: ${result.tag}`);
  return result.build;
}

function walkSpeedFeet(build: ReturnType<typeof fighterBuild>) {
  const init = expectSuccess(
    battleCreatureInitFromCharacterBuild({
      combatantId: combatantId("lineage-walker"),
      characterId: characterId("character:lineage-walker"),
      displayName: "Lineage Walker",
      build,
      initiative: initiativeScore(10),
      ammunitionStocks: [],
      resourceExpenditures: [],
      unitLibrary,
    }),
  );
  const battle = expectSuccess(
    startBattle({
      battleId: battleId("battle:lineage-walk-speed"),
      combatants: [init],
    }),
  );
  return snapshotBattle(battle.state).combatants[0]?.movement.speedFeet;
}

function legacyTraitProfiles(build: ReturnType<typeof fighterBuild>) {
  const { unitRefs } = expectSuccess(
    characterBattleSupportProjection(build, unitLibrary, undefined, [
      { className: "fighter", level: 1 },
    ]),
  );
  return unitRefs.find(
    (ref) => ref.unit.id === "species_tiefling_fiendish_legacy",
  )?.supportProfiles;
}

describe("species lineage Battle passives", () => {
  test.each([
    ["abyssal", "poison"],
    ["chthonic", "necrotic"],
    ["infernal", "fire"],
  ] as const)(
    "gives a %s Tiefling the legacy's %s Resistance",
    (legacy, damageType) => {
      expect(
        legacyTraitProfiles(fighterBuild("species_tiefling", legacy)),
      ).toEqual([
        {
          kind: PASSIVE_DAMAGE_RESISTANCE_SUPPORT_PROFILE,
          resistance: { damageType: { kind: "fixed", value: damageType } },
        },
      ]);
    },
  );

  test("gives a Wood Elf a 35-foot Speed and other elves the species Speed", () => {
    expect(walkSpeedFeet(fighterBuild("species_elf", "wood_elf"))).toBe(35);
    expect(walkSpeedFeet(fighterBuild("species_elf", "high_elf"))).toBe(30);
    expect(walkSpeedFeet(fighterBuild("species_elf", "drow"))).toBe(30);
  });
});
