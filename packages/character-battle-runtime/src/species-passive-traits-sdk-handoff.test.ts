// UNIT-PROFILE-COVERAGE: verification-owner:runtime-test unit-feature.passive-saving-throw-roll-mode
import { savingThrowTargetModifiers } from "../../battle-runtime/src/battle-reducer/saving-throw-modifier-collector.ts";
import {
  grappleOutcomeFill,
  targetFill,
} from "../../battle-runtime/src/battle-runtime.test-support.ts";
import { battleRuntimeSessionForTest } from "@dnd/battle-runtime/test-support";
import { statBlockId, unitId as authoredUnitId } from "@dnd/shared/game-facts";
import {
  combatantId,
  discoverBattleActs,
  endTurn,
  resolveBattleSubject,
  type CombatantId,
} from "@dnd/battle-runtime";
import { describe, expect, test } from "vitest";

import {
  battleSessionFromSheets,
  characterSheet,
  levelFiveMartialBuild,
  monsterBattleInput,
  requireHole,
  requireResolved,
  srdStatBlock,
} from "./sdk-integration.test-support.ts";

type Species =
  | "species_dwarf"
  | "species_gnome"
  | "species_goliath"
  | "species_halfling"
  | "species_orc";

const ORIGIN_LANGUAGES = ["Common", "Halfling", "Dwarvish"] as const;

/** A Fighter 5 of `species`, built from a sheet. */
function fighterSheet(species: Species, id: CombatantId, initiative: number) {
  return characterSheet({
    characterIdText: `character:${id}`,
    combatantId: id,
    build: {
      ...levelFiveMartialBuild({
        classUnitId: authoredUnitId("class_fighter"),
        weaponUnitId: authoredUnitId("weapon_longsword"),
      }),
      species: authoredUnitId(species),
      originLanguages: ORIGIN_LANGUAGES,
    },
    initiative,
  });
}

function saveRollModes(
  species: Species,
  context: Parameters<typeof savingThrowTargetModifiers>[1],
) {
  const id = combatantId(`combatant:${species}`);
  const session = battleSessionFromSheets({
    battleIdText: `battle:passive-${species}`,
    characters: [fighterSheet(species, id, 20)],
    monsters: [
      monsterBattleInput(
        combatantId("opponent"),
        10,
        srdStatBlock(statBlockId("stat_block_skeleton")),
      ),
    ],
  });
  return savingThrowTargetModifiers(session.state, context, "everyCombatant")
    .targetRollModes;
}

/** The roll mode of `species`'s Athletics check to escape a grapple. */
function escapeGrappleRollMode(species: Species) {
  const grapplerId = combatantId("combatant:grappler");
  const escaperId = combatantId(`combatant:escaper-${species}`);
  const session = battleSessionFromSheets({
    battleIdText: `battle:escape-${species}`,
    characters: [
      fighterSheet("species_orc", grapplerId, 20),
      fighterSheet(species, escaperId, 10),
    ],
    monsters: [],
  });
  const grapple = {
    tag: "action",
    actorId: grapplerId,
    action: "grapple",
  } as const;
  const target = targetFill(
    requireHole(
      resolveBattleSubject({
        state: session.state,
        subject: grapple,
        fills: [],
      }),
      "targetChoice",
    ),
    escaperId,
    [{ kind: "grappleTargetWithinReach", grapplerId, targetId: escaperId }],
  );
  const outcome = requireHole(
    resolveBattleSubject({
      state: session.state,
      subject: grapple,
      fills: [target],
    }),
    "grappleOutcome",
  );
  const grappled = requireResolved(
    resolveBattleSubject({
      state: session.state,
      subject: grapple,
      fills: [target, grappleOutcomeFill(outcome, false)],
    }),
  ).state;
  const escaperTurn = requireResolved(
    endTurn({ state: grappled, actorId: grapplerId }),
  ).state;
  const escape = discoverBattleActs(
    battleRuntimeSessionForTest({
      context: session.context,
      state: escaperTurn,
    }),
  ).find(
    (act) =>
      act.subject.tag === "action" &&
      act.subject.action === "escapeGrapple" &&
      act.subject.actorId === escaperId &&
      "skill" in act.subject &&
      act.subject.skill === "athletics",
  );
  if (escape === undefined) throw new Error("Expected the escape act.");
  const check = requireHole(
    resolveBattleSubject({
      state: escaperTurn,
      subject: escape.subject,
      fills: [],
    }),
    "grappleOutcome",
  );
  return "rollMode" in check ? check.rollMode : undefined;
}

describe("species passive traits real-catalog SDK handoff", () => {
  test("Brave gives a Halfling from a sheet Advantage on saves against Frightened", () => {
    const halflingId = combatantId("combatant:species_halfling");
    expect(
      saveRollModes("species_halfling", {
        ability: "wis",
        avoidsCondition: "frightened",
      }),
    ).toEqual([{ targetId: halflingId, rollMode: "advantage" }]);
    expect(
      saveRollModes("species_orc", {
        ability: "wis",
        avoidsCondition: "frightened",
      }),
    ).toEqual([]);
  });

  test("Dwarven Resilience gives a Dwarf from a sheet Advantage on saves against Poisoned", () => {
    expect(
      saveRollModes("species_dwarf", {
        ability: "con",
        avoidsCondition: "poisoned",
      }),
    ).toEqual([
      {
        targetId: combatantId("combatant:species_dwarf"),
        rollMode: "advantage",
      },
    ]);
  });

  test("Gnomish Cunning gives a Gnome from a sheet Advantage on Intelligence, Wisdom and Charisma saves", () => {
    const gnomeId = combatantId("combatant:species_gnome");
    for (const ability of ["int", "wis", "cha"] as const) {
      expect(saveRollModes("species_gnome", { ability })).toEqual([
        { targetId: gnomeId, rollMode: "advantage" },
      ]);
    }
    expect(saveRollModes("species_gnome", { ability: "dex" })).toEqual([]);
  });

  test("Powerful Build gives a Goliath from a sheet Advantage on the check to escape a grapple", () => {
    expect(escapeGrappleRollMode("species_goliath")).toBe("advantage");
    expect(escapeGrappleRollMode("species_orc")).toBeUndefined();
  });
});
