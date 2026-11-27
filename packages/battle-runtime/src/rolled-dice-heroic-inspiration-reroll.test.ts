// KERNEL-COVERAGE: parity-witness BATTLE.ROLLED_DICE.HEROIC_INSPIRATION_REROLL
import {
  HEROIC_INSPIRATION_AVAILABLE,
  NO_HEROIC_INSPIRATION,
  unitId as parseSharedUnitId,
  type HeroicInspiration,
} from "@dnd/shared/game-facts";
import { DieRollResult } from "@dnd/shared/types";
import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import {
  BattleFillSchema,
  BattleHoleSchema,
} from "./battle-reducer/battle-codecs.ts";
import { HEROIC_INSPIRATION_REROLL_UNAVAILABLE_MESSAGE } from "./battle-reducer/heroic-inspiration-reroll.ts";
import {
  ROLLED_DICE_HEROIC_INSPIRATION_CANDIDATE_MESSAGE,
  ROLLED_DICE_HEROIC_INSPIRATION_EMPOWERED_SPELL_MESSAGE,
  ROLLED_DICE_HEROIC_INSPIRATION_GROUP_MESSAGE,
  ROLLED_DICE_HEROIC_INSPIRATION_NOT_OFFERED_MESSAGE,
  ROLLED_DICE_HEROIC_INSPIRATION_REPLACEMENT_MESSAGE,
  ROLLED_DICE_HEROIC_INSPIRATION_SAVAGE_ATTACKER_MESSAGE,
} from "./battle-reducer/rolled-dice-heroic-inspiration-reroll.ts";
import {
  attackRollFill,
  characterSeed,
  damageRollFillWithGroups,
  fighterAttackSubject,
  fighterId,
  goblinId,
  requireCharacterUnitProcedureRefForTest,
  requireHole,
  requireOrdinaryFrontier,
  requireResolved,
  resolveBattleSubject,
  startBattleRight,
  statBlockCreatureInit,
  targetFill,
  type BattleState,
} from "./battle-runtime.test-support.ts";
import type { BattleRuntimeSession } from "./battle-runtime-context.ts";
import { battleRuntimeSessionForTest } from "./battle-runtime-session.test-support.ts";
import {
  HEROIC_INSPIRATION_REROLL_EFFECT_KIND,
  type BattleFill,
  type BattleHole,
  type BattleResolutionResult,
  type BattleRolledDiceHeroicInspirationRerollDecision,
  type BattleRolledDieRef,
} from "./battle-state-execution.ts";
import { battleObjectId, type CombatantId } from "./identity.ts";
import {
  cureWoundsUnitId,
  greatWeaponFightingUnitId,
  savageAttackerUnitId,
  spellCasterId,
  spellTargetId,
} from "./unit-profile-admission-catalog.test-support.ts";
import {
  attackRollFill as admissionAttackRollFill,
  attackTargetFill,
  damageRollFillWithGroups as admissionDamageRollFill,
  requireHole as requireListedHole,
  requireResultHole,
  weaponAttackSubject,
  zeroAbilityWeaponAttack,
} from "./unit-profile-admission-creature-fixture.test-support.ts";
import {
  greatWeaponFightingBattle,
  savageAttackerBattle,
} from "./unit-profile-admission-feature-fixture.test-support.ts";
import { spellBattle } from "./unit-profile-admission-spell-battle.test-support.ts";
import {
  spellAct,
  spellTargetFill,
} from "./unit-profile-admission-spell-fill.test-support.ts";
import { spellRecord } from "./unit-profile-admission-spell-record.test-support.ts";
import {
  applyBattleHitPointDamage,
  battleId,
} from "./unit-profile-admission.test-support.ts";
import type { CharacterBattleCreatureInit } from "./battle-init.ts";

type RolledDiceFill = Extract<BattleFill, { readonly kind: "rolledDice" }>;
type RolledDiceHole = Extract<BattleHole, { readonly kind: "rolledDice" }>;

describe("Heroic Inspiration reroll on weapon attack damage (A71)", () => {
  test("a character with Heroic Inspiration is asked again for their damage dice", () => {
    const state = fighterBattle(HEROIC_INSPIRATION_AVAILABLE);
    const hit = longswordHit(state);
    expect(hit.damage).toMatchObject({ rollerId: fighterId });
    expect(hit.damage).not.toHaveProperty("heroicInspirationRerolls");

    const asked = resolveBattleSubject({
      state,
      subject: hit.subject,
      fills: [...hit.fills, damageRollFillWithGroups(hit.damage, [[2]])],
    });

    expect(requireHole(asked, "rolledDice")).toMatchObject({
      holeId: hit.damage.holeId,
      rollerId: fighterId,
      heroicInspirationRerolls: [
        { effectKind: HEROIC_INSPIRATION_REROLL_EFFECT_KIND },
      ],
    });
    expect(
      heroicInspiration(requireNeedsHoles(asked).state, fighterId),
    ).toEqual(HEROIC_INSPIRATION_AVAILABLE);
  });

  test("declining keeps the dice and Heroic Inspiration", () => {
    const state = fighterBattle(HEROIC_INSPIRATION_AVAILABLE);
    const hit = longswordHit(state);

    const resolved = requireResolved(
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [...hit.fills, damageFill(hit.damage, [[2]], declined())],
      }),
    ).state;

    expect(goblinHp(state) - goblinHp(resolved)).toBe(
      damageDealt(state, [[2]]),
    );
    expect(heroicInspiration(resolved, fighterId)).toEqual(
      HEROIC_INSPIRATION_AVAILABLE,
    );
  });

  test("a reroll uses the new face and spends Heroic Inspiration once", () => {
    const state = fighterBattle(HEROIC_INSPIRATION_AVAILABLE);
    const hit = longswordHit(state);
    // The die showed a 4, rerolled to a 1, and the new roll must be used.
    const fill = damageFill(
      hit.damage,
      [[1]],
      rerolled({ source: "rolledDiceGroup", groupIndex: 0 }, 4, 1),
    );

    const resolved = requireResolved(
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [...hit.fills, fill],
      }),
    ).state;

    expect(goblinHp(state) - goblinHp(resolved)).toBe(
      damageDealt(state, [[1]]),
    );
    expect(damageDealt(state, [[1]])).toBeLessThan(damageDealt(state, [[4]]));
    expect(heroicInspiration(resolved, fighterId)).toEqual(
      NO_HEROIC_INSPIRATION,
    );
  });

  test("the rerolled die must show its replacement in the named group", () => {
    const state = fighterBattle(HEROIC_INSPIRATION_AVAILABLE);
    const hit = longswordHit(state);

    expect(
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [
          ...hit.fills,
          damageFill(
            hit.damage,
            [[5]],
            rerolled({ source: "rolledDiceGroup", groupIndex: 0 }, 2, 7),
          ),
        ],
      }),
    ).toMatchObject({
      tag: "invalid",
      message: ROLLED_DICE_HEROIC_INSPIRATION_REPLACEMENT_MESSAGE,
    });
    expect(
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [
          ...hit.fills,
          damageFill(
            hit.damage,
            [[7]],
            rerolled({ source: "rolledDiceGroup", groupIndex: 3 }, 2, 7),
          ),
        ],
      }),
    ).toMatchObject({
      tag: "invalid",
      message: ROLLED_DICE_HEROIC_INSPIRATION_GROUP_MESSAGE,
    });
  });

  test("the face a reroll replaced must be one the die could show", () => {
    const state = fighterBattle(HEROIC_INSPIRATION_AVAILABLE);
    const hit = longswordHit(state);

    const result = resolveBattleSubject({
      state,
      subject: hit.subject,
      fills: [
        ...hit.fills,
        damageFill(
          hit.damage,
          [[7]],
          rerolled({ source: "rolledDiceGroup", groupIndex: 0 }, 9, 7),
        ),
      ],
    });

    expect(result.tag).toBe("invalid");
    expect(result.tag === "invalid" ? result.message : "").toMatch(
      /^The roll before Heroic Inspiration: /,
    );
  });

  test("a reroll that names a Savage Attacker roll or an Empowered Spell die the fill lacks is refused", () => {
    const state = fighterBattle(HEROIC_INSPIRATION_AVAILABLE);
    const hit = longswordHit(state);
    const attempt = (rolledDie: BattleRolledDieRef) =>
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [
          ...hit.fills,
          damageFill(hit.damage, [[7]], rerolled(rolledDie, 2, 7)),
        ],
      });

    expect(
      attempt({ source: "weaponDamageDiceRollCandidate", candidate: "first" }),
    ).toMatchObject({
      tag: "invalid",
      message: ROLLED_DICE_HEROIC_INSPIRATION_CANDIDATE_MESSAGE,
    });
    expect(attempt({ source: "spellDamageReroll" })).toMatchObject({
      tag: "invalid",
      message: ROLLED_DICE_HEROIC_INSPIRATION_EMPOWERED_SPELL_MESSAGE,
    });
  });

  test("a character without Heroic Inspiration is not asked, and a decision is refused", () => {
    const state = fighterBattle(NO_HEROIC_INSPIRATION);
    const hit = longswordHit(state);

    expect(
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [...hit.fills, damageRollFillWithGroups(hit.damage, [[2]])],
      }).tag,
    ).toBe("resolved");
    expect(
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [...hit.fills, damageFill(hit.damage, [[2]], declined())],
      }),
    ).toMatchObject({
      tag: "invalid",
      message: HEROIC_INSPIRATION_REROLL_UNAVAILABLE_MESSAGE,
    });
  });

  test("Heroic Inspiration spent on the attack roll is not offered again on its damage", () => {
    const state = fighterBattle(HEROIC_INSPIRATION_AVAILABLE);
    const hit = longswordHit(state, [
      {
        kind: "reroll",
        effectKind: HEROIC_INSPIRATION_REROLL_EFFECT_KIND,
        replacement: {
          total: 20,
          d20TestRoll: { tag: "single", naturalD20: DieRollResult(15) },
        },
      },
    ]);

    const resolved = requireResolved(
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [...hit.fills, damageRollFillWithGroups(hit.damage, [[2]])],
      }),
    ).state;
    expect(heroicInspiration(resolved, fighterId)).toEqual(
      NO_HEROIC_INSPIRATION,
    );
    // The roller had the choice before spending it, so a decline stands.
    expect(
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [...hit.fills, damageFill(hit.damage, [[2]], declined())],
      }).tag,
    ).toBe("resolved");
    expect(
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [
          ...hit.fills,
          damageFill(
            hit.damage,
            [[2]],
            rerolled({ source: "rolledDiceGroup", groupIndex: 0 }, 4, 2),
          ),
        ],
      }),
    ).toMatchObject({
      tag: "invalid",
      message: HEROIC_INSPIRATION_REROLL_UNAVAILABLE_MESSAGE,
    });
  });

  test("a decision on dice no hole asks for yet is refused", () => {
    const state = fighterBattle(HEROIC_INSPIRATION_AVAILABLE);
    const hit = longswordHit(state);
    const [selection] = hit.fills;
    if (selection === undefined) throw new Error("Expected a target fill.");

    expect(
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [selection, damageFill(hit.damage, [[2]], declined())],
      }),
    ).toMatchObject({
      tag: "invalid",
      message: ROLLED_DICE_HEROIC_INSPIRATION_NOT_OFFERED_MESSAGE,
    });
  });

  test("the decision and the asked hole round-trip through the codecs", () => {
    const state = fighterBattle(HEROIC_INSPIRATION_AVAILABLE);
    const hit = longswordHit(state);
    const fill = damageFill(
      hit.damage,
      [[7]],
      rerolled({ source: "rolledDiceGroup", groupIndex: 0 }, 2, 7),
    );
    const asked = requireHole(
      resolveBattleSubject({
        state,
        subject: hit.subject,
        fills: [...hit.fills, damageRollFillWithGroups(hit.damage, [[2]])],
      }),
      "rolledDice",
    );

    expect(
      Schema.decodeUnknownSync(BattleFillSchema)(
        Schema.encodeSync(BattleFillSchema)(fill),
      ),
    ).toEqual(fill);
    expect(
      Schema.decodeUnknownSync(BattleHoleSchema)(
        Schema.encodeSync(BattleHoleSchema)(asked),
      ),
    ).toEqual(asked);
  });
});

describe("Heroic Inspiration with Savage Attacker and Great Weapon Fighting (A71)", () => {
  test("Heroic Inspiration rerolls a die of the Savage Attacker roll it belongs to", () => {
    const session = withHeroicInspiration(
      savageAttackerBattle({
        attack: zeroAbilityWeaponAttack("weapon_longsword"),
      }),
      spellCasterId,
    );
    const hit = admissionWeaponHit(session, "Longsword");
    const procedureRef = requireCharacterUnitProcedureRefForTest(
      session,
      spellCasterId,
      savageAttackerUnitId,
    );
    // The first roll showed a 1, rerolled to a 6; the second roll showed a 3.
    const savageFill = (rolledDie: BattleRolledDieRef): RolledDiceFill => ({
      ...admissionDamageRollFill(hit.damage, [[6]], undefined, {
        procedureRef,
        selection: "first",
        candidates: [
          { results: [DieRollResult(6)] },
          { results: [DieRollResult(3)] },
        ],
      }),
      heroicInspirationReroll: rerolled(rolledDie, 1, 6),
    });

    const resolved = requireResolved(
      resolveBattleSubject({
        state: session.state,
        subject: hit.subject,
        fills: [
          ...hit.fills,
          savageFill({
            source: "weaponDamageDiceRollCandidate",
            candidate: "first",
          }),
        ],
      }),
    ).state;
    expect(Number(resolved.combatants.get(spellTargetId)?.hp)).toBe(12 - 6);
    expect(heroicInspiration(resolved, spellCasterId)).toEqual(
      NO_HEROIC_INSPIRATION,
    );
    expect(
      resolveBattleSubject({
        state: session.state,
        subject: hit.subject,
        fills: [
          ...hit.fills,
          savageFill({ source: "rolledDiceGroup", groupIndex: 0 }),
        ],
      }),
    ).toMatchObject({
      tag: "invalid",
      message: ROLLED_DICE_HEROIC_INSPIRATION_SAVAGE_ATTACKER_MESSAGE,
    });
  });

  test("Great Weapon Fighting's floor applies to the die that stands after the reroll", () => {
    const session = withHeroicInspiration(
      greatWeaponFightingBattle({
        attack: zeroAbilityWeaponAttack("weapon_greataxe"),
        selectedLoadout: mainWeaponLoadout(
          parseSharedUnitId("weapon_greataxe"),
          "two_handed",
        ),
      }),
      spellCasterId,
    );
    const hit = admissionWeaponHit(session, "Greataxe");
    // The roll showed a 5, rerolled to a 1, which the floor treats as a 3.
    const fill: RolledDiceFill = {
      ...admissionDamageRollFill(hit.damage, [[1]], undefined, undefined, {
        procedureRef: requireCharacterUnitProcedureRefForTest(
          session,
          spellCasterId,
          greatWeaponFightingUnitId,
        ),
        selection: "apply",
      }),
      heroicInspirationReroll: rerolled(
        { source: "rolledDiceGroup", groupIndex: 0 },
        5,
        1,
      ),
    };

    const resolved = requireResolved(
      resolveBattleSubject({
        state: session.state,
        subject: hit.subject,
        fills: [...hit.fills, fill],
      }),
    ).state;
    expect(Number(resolved.combatants.get(spellTargetId)?.hp)).toBe(12 - 3);
  });
});

describe("Heroic Inspiration reroll on spell healing (A71)", () => {
  test("the caster may reroll one healing die, and the target heals by the new face", () => {
    const session = woundedTargetSession(
      withHeroicInspiration(
        spellBattle({ preparedSpells: [spellRecord(cureWoundsUnitId)] }),
        spellCasterId,
      ),
    );
    const act = spellAct({ session, spellId: cureWoundsUnitId });
    const target = spellTargetFill(
      requireListedHole(act.initialHoles, "targetChoice"),
      cureWoundsUnitId,
      spellCasterId,
      spellTargetId,
    );
    const awaiting = requireNeedsHoles(
      resolveBattleSubject({
        state: session.state,
        subject: act.subject,
        fills: [target],
      }),
    );
    const healing = requireHole(awaiting, "rolledDice");
    expect(healing).toMatchObject({ rollerId: spellCasterId });
    const replay = {
      state: awaiting.state,
      subject: requireOrdinaryFrontier(awaiting).replaySubject,
    };

    expect(
      requireHole(
        resolveBattleSubject({
          ...replay,
          fills: [target, damageRollFillWithGroups(healing, [[1, 2]])],
        }),
        "rolledDice",
      ),
    ).toMatchObject({
      heroicInspirationRerolls: [
        { effectKind: HEROIC_INSPIRATION_REROLL_EFFECT_KIND },
      ],
    });
    const hpBefore = Number(awaiting.state.combatants.get(spellTargetId)?.hp);
    const resolved = requireResolved(
      resolveBattleSubject({
        ...replay,
        fills: [
          target,
          damageFill(
            healing,
            [[3, 1]],
            rerolled({ source: "rolledDiceGroup", groupIndex: 0 }, 1, 3),
          ),
        ],
      }),
    ).state;
    // Cure Wounds heals 2d8 plus the caster's +3 spellcasting modifier.
    expect(Number(resolved.combatants.get(spellTargetId)?.hp)).toBe(
      hpBefore + 3 + 1 + 3,
    );
    expect(heroicInspiration(resolved, spellCasterId)).toEqual(
      NO_HEROIC_INSPIRATION,
    );
  });
});

function fighterBattle(inspiration: HeroicInspiration): BattleState {
  return startBattleRight({
    battleId: battleId("heroic-inspiration-damage-dice"),
    combatants: [
      characterSeed({ initiative: 20, heroicInspiration: inspiration }),
      statBlockCreatureInit({ initiative: 10 }),
    ],
  });
}

/** The fills up to a Longsword hit on the goblin, and its damage hole. */
function longswordHit(
  state: BattleState,
  d20TestRerolls: readonly AttackRollReroll[] = heroicInspiration(
    state,
    fighterId,
  ) === HEROIC_INSPIRATION_AVAILABLE
    ? [{ kind: "decline", effectKind: HEROIC_INSPIRATION_REROLL_EFFECT_KIND }]
    : [],
) {
  const subject = fighterAttackSubject(state, "Longsword");
  const selection = targetFill(
    requireHole(
      resolveBattleSubject({ state, subject, fills: [] }),
      "targetChoice",
    ),
    goblinId,
  );
  const roll = requireHole(
    resolveBattleSubject({ state, subject, fills: [selection] }),
    "attackRoll",
  );
  const fills: readonly BattleFill[] = [
    selection,
    attackRollFill(roll, {
      total: 20,
      naturalD20: 15,
      ...nonEmptyRerolls(d20TestRerolls),
    }),
  ];
  const damage = requireHole(
    resolveBattleSubject({ state, subject, fills }),
    "rolledDice",
  );
  return { subject, fills, damage };
}

type AttackRollReroll = NonNullable<
  Parameters<typeof attackRollFill>[1]["d20TestRerolls"]
>[number];

function nonEmptyRerolls(rerolls: readonly AttackRollReroll[]) {
  const [first, ...rest] = rerolls;
  return first === undefined
    ? {}
    : { d20TestRerolls: [first, ...rest] as const };
}

function requireNeedsHoles(
  result: BattleResolutionResult,
): Extract<BattleResolutionResult, { readonly tag: "needsHoles" }> {
  if (result.tag !== "needsHoles") {
    throw new Error(`Expected needsHoles, got ${result.tag}.`);
  }
  return result;
}

/** The damage the fighter's Longsword deals on a hit with these dice and no reroll. */
function damageDealt(
  inspirationState: BattleState,
  groups: readonly (readonly number[])[],
): number {
  const state = withoutHeroicInspiration(inspirationState, fighterId);
  const hit = longswordHit(state);
  const resolved = requireResolved(
    resolveBattleSubject({
      state,
      subject: hit.subject,
      fills: [...hit.fills, damageRollFillWithGroups(hit.damage, groups)],
    }),
  ).state;
  return goblinHp(state) - goblinHp(resolved);
}

/** The fills up to a weapon hit in the unit-profile fixtures, and its damage hole. */
function admissionWeaponHit(session: BattleRuntimeSession, attackName: string) {
  const state = session.state;
  const subject = weaponAttackSubject(session, attackName);
  const target = attackTargetFill(
    requireResultHole(
      resolveBattleSubject({ state, subject, fills: [] }),
      "targetChoice",
    ),
    spellCasterId,
    spellTargetId,
  );
  const roll = requireResultHole(
    resolveBattleSubject({ state, subject, fills: [target] }),
    "attackRoll",
  );
  const fills: readonly BattleFill[] = [
    target,
    admissionAttackRollFill(roll, {
      total: 15,
      naturalD20: 10,
      d20TestRerolls: [
        { kind: "decline", effectKind: HEROIC_INSPIRATION_REROLL_EFFECT_KIND },
      ],
    }),
  ];
  const damage = requireResultHole(
    resolveBattleSubject({ state, subject, fills }),
    "rolledDice",
  );
  return { subject, fills, damage };
}

function woundedTargetSession(
  session: BattleRuntimeSession,
): BattleRuntimeSession {
  const target = session.state.combatants.get(spellTargetId);
  if (target === undefined) throw new Error("Expected the healing target.");
  return battleRuntimeSessionForTest({
    ...session,
    state: applyBattleHitPointDamage({
      saveGatedConditionDamageRepeatSave: { kind: "noRepeatSave" },
      state: session.state,
      target,
      damageAmount: Number(target.hp) - 1,
      deathFailuresAtZeroHp: 1,
      damageDisposition: { kind: "knockOut" },
    }),
  });
}

function damageFill(
  hole: RolledDiceHole,
  groups: readonly (readonly number[])[],
  heroicInspirationReroll: BattleRolledDiceHeroicInspirationRerollDecision,
): RolledDiceFill {
  return {
    ...damageRollFillWithGroups(hole, groups),
    heroicInspirationReroll,
  };
}

function declined(): BattleRolledDiceHeroicInspirationRerollDecision {
  return { kind: "decline", effectKind: HEROIC_INSPIRATION_REROLL_EFFECT_KIND };
}

function rerolled(
  rolledDie: BattleRolledDieRef,
  original: number,
  replacement: number,
): BattleRolledDiceHeroicInspirationRerollDecision {
  return {
    kind: "rerollRolledDie",
    effectKind: HEROIC_INSPIRATION_REROLL_EFFECT_KIND,
    rolledDie,
    original: DieRollResult(original),
    replacement: DieRollResult(replacement),
  };
}

function withHeroicInspiration(
  session: BattleRuntimeSession,
  id: CombatantId,
): BattleRuntimeSession {
  return battleRuntimeSessionForTest({
    ...session,
    state: stateWithHeroicInspiration(
      session.state,
      id,
      HEROIC_INSPIRATION_AVAILABLE,
    ),
  });
}

function withoutHeroicInspiration(
  state: BattleState,
  id: CombatantId,
): BattleState {
  return stateWithHeroicInspiration(state, id, NO_HEROIC_INSPIRATION);
}

function stateWithHeroicInspiration(
  state: BattleState,
  id: CombatantId,
  inspiration: HeroicInspiration,
): BattleState {
  const creature = state.combatants.get(id);
  if (creature?.origin.kind !== "character") {
    throw new Error("Expected a character combatant.");
  }
  return {
    ...state,
    combatants: new Map(state.combatants).set(id, {
      ...creature,
      origin: { ...creature.origin, heroicInspiration: inspiration },
    }),
  };
}

function goblinHp(state: BattleState): number {
  return Number(state.combatants.get(goblinId)?.hp);
}

function heroicInspiration(
  state: BattleState,
  id: CombatantId,
): HeroicInspiration | undefined {
  const creature = state.combatants.get(id);
  return creature?.origin.kind === "character"
    ? creature.origin.heroicInspiration
    : undefined;
}

type CharacterSelectedLoadout = Extract<
  CharacterBattleCreatureInit,
  { readonly kind: "character" }
>["selectedLoadout"];

function mainWeaponLoadout(
  unitId: ReturnType<typeof parseSharedUnitId>,
  grip: "one_handed" | "two_handed",
): CharacterSelectedLoadout {
  return { weapon: { itemId: battleObjectId(`main:${unitId}`), unitId, grip } };
}
