// UNIT-PROFILE-COVERAGE: verification-owner:runtime-test unit-feature.d20-test-natural-one-reroll
import { statBlockId, unitId as authoredUnitId } from "@dnd/shared/game-facts";
import {
  characterProcedureBinding,
  combatantId,
  resolveBattleSubject,
  type BattleFill,
} from "@dnd/battle-runtime";
import { DieRollResult } from "@dnd/shared/types";
import { describe, expect, test } from "vitest";

import {
  attackRollFill,
  attackSubject,
  attackTargetFill,
  battleSessionFromSheets,
  characterSheet,
  levelFiveMartialBuild,
  monsterBattleInput,
  requireCharacterCombatant,
  requireHole,
  srdStatBlock,
} from "./sdk-integration.test-support.ts";

const halflingId = combatantId("combatant:halfling-luck-sdk-handoff");
const opponentId = combatantId("combatant:halfling-luck-sdk-opponent");

/** A Fighter 5 with a Longsword, built from a sheet as a Halfling or an Orc. */
function fighterSession(species: "species_halfling" | "species_orc") {
  const build = {
    ...levelFiveMartialBuild({
      classUnitId: authoredUnitId("class_fighter"),
      weaponUnitId: authoredUnitId("weapon_longsword"),
    }),
    species: authoredUnitId(species),
    originLanguages: ["Common", "Halfling", "Dwarvish"] as const,
  };
  return battleSessionFromSheets({
    battleIdText: `battle:luck-${species}`,
    characters: [
      characterSheet({
        characterIdText: `character:luck-${species}`,
        combatantId: halflingId,
        build,
        initiative: 20,
      }),
    ],
    monsters: [
      monsterBattleInput(
        opponentId,
        10,
        srdStatBlock(statBlockId("stat_block_skeleton")),
      ),
    ],
  });
}

function longswordRoll(session: ReturnType<typeof fighterSession>) {
  const subject = attackSubject(session, halflingId, "Longsword");
  const target = requireHole(
    resolveBattleSubject({ state: session.state, subject, fills: [] }),
    "targetChoice",
  );
  const selectedTarget = attackTargetFill(
    target,
    halflingId,
    opponentId,
    "Longsword",
  );
  const roll = requireHole(
    resolveBattleSubject({
      state: session.state,
      subject,
      fills: [selectedTarget],
    }),
    "attackRoll",
  );
  return { subject, selectedTarget, roll };
}

describe("Halfling Luck real-catalog SDK handoff", () => {
  test("a Halfling built from a sheet is offered Luck on a natural 1, and the new roll stands", () => {
    const session = fighterSession("species_halfling");
    const actor = requireCharacterCombatant(session.state, halflingId);
    const luckRef = session.context.characters
      .get(halflingId)
      ?.unitProcedureOwnership.find(
        (entry) => entry.unitId === "species_halfling_luck",
      )?.procedureRef;
    if (luckRef === undefined) {
      throw new Error("Expected Luck procedure ownership.");
    }
    // A sheet binds Luck as a support profile, not a Unit feature.
    expect(
      characterProcedureBinding(actor.origin.execution, luckRef),
    ).toMatchObject({
      procedure: {
        kind: "unitSupportProfile",
        execution: { kind: "d20TestNaturalOneReroll" },
      },
    });

    const { subject, selectedTarget, roll } = longswordRoll(session);
    const naturalOne = attackRollFill(roll, { total: 4, naturalD20: 1 });
    const offered = requireHole(
      resolveBattleSubject({
        state: session.state,
        subject,
        fills: [selectedTarget, naturalOne],
      }),
      "attackRoll",
    );
    const [offer] = offered.d20TestNaturalOneRerolls ?? [];
    if (offer === undefined) {
      throw new Error("Expected the natural-1 reroll offer.");
    }

    const rerolled: BattleFill = {
      ...naturalOne,
      value: {
        ...naturalOne.value,
        d20TestRerolls: [
          {
            kind: "reroll",
            effectKind: offer.effectKind,
            replacement: {
              total: 20,
              d20TestRoll: { tag: "single", naturalD20: DieRollResult(17) },
            },
          },
        ],
      },
    };
    expect(
      requireHole(
        resolveBattleSubject({
          state: session.state,
          subject,
          fills: [selectedTarget, rerolled],
        }),
        "rolledDice",
      ),
    ).toMatchObject({ critical: false });
  });

  test("an Orc built from the same sheet is not offered Luck", () => {
    const session = fighterSession("species_orc");
    const { subject, selectedTarget, roll } = longswordRoll(session);
    expect(
      resolveBattleSubject({
        state: session.state,
        subject,
        fills: [
          selectedTarget,
          attackRollFill(roll, { total: 4, naturalD20: 1 }),
        ],
      }),
    ).toMatchObject({ tag: "resolved" });
  });
});
