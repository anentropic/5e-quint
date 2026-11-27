// UNIT-PROFILE-COVERAGE: verification-owner:runtime-test unit-feature.failed-save-reaction-reroll
// KERNEL-COVERAGE: parity-witness BATTLE.D20_TEST.FAILED_SAVE_REACTION_REROLL
// UNIT-IDENTITY-EVIDENCE: deterministic-admission-projection U580-COUNTERCHARM bard_countercharm
// Countercharm (SRD 5.2.1 classes.md, Bard, Level 7: Countercharm): "If you
// or a creature within 30 feet of you fails a saving throw against an effect
// that applies the Charmed or Frightened condition, you can take a Reaction
// to cause the save to be rerolled, and the new roll has Advantage."
import { applyCondition } from "@dnd/shared-algebras/conditions-algebra";
import { elapsedTimeTicks } from "@dnd/shared-algebras/elapsed-time-algebra";
import { difficultyClass, DieRollResult } from "@dnd/shared/types";
import { Result, Schema } from "effect";
import { describe, expect, test } from "vitest";

import {
  battleFrontierInterruptDecisionForState,
  battleResolutionHolesForTest,
  battleStateWithAllocatedEffectForTest,
  discoverBattleActCandidates,
  endTurn,
  characterBattleFeatureInitForTest,
  interruptDecisionFill,
  resolveBattleInterrupt,
  resolveBattleSubject,
  testBattleCreatureStateWithConditions,
  type BattleState,
  type BattleSubject,
} from "./battle-runtime.test-support.ts";
import {
  HEROIC_INSPIRATION_AVAILABLE,
  NO_HEROIC_INSPIRATION,
  type Condition,
  type HeroicInspiration,
} from "@dnd/shared/game-facts";
import { battleStateWithLowLevelSourceOwnedEffectOccurrenceForTest } from "./low-level-effect-occurrence.test-support.ts";
import { optionalProperty } from "./optional-property.ts";
import {
  FAILED_SAVE_REACTION_REROLL_EFFECT_KIND,
  HEROIC_INSPIRATION_REROLL_EFFECT_KIND,
  type BattleD20TestRoll,
  type BattleResolutionResult,
  type BattleRolledOutcomeD20TestRerollDecisions,
  type BattleFailedSaveReactionReroll,
  type BattleInterruptProcedureChoice,
  type BattleHole,
} from "./battle-state-execution.ts";
import {
  failedSaveReactionRerollRollMode,
  FAILED_SAVE_REACTION_REROLL_MODE_MESSAGE,
  FAILED_SAVE_REACTION_REROLL_WITHOUT_GRANT_MESSAGE,
} from "./battle-reducer/failed-save-reaction-reroll.ts";
import { currentInterruptCheckpoint } from "./battle-reducer/battle-snapshot.ts";
import { battleInterruptDecisionFillSchema } from "./battle-reducer/battle-codecs.ts";
import { HEROIC_INSPIRATION_REROLL_UNAVAILABLE_MESSAGE } from "./battle-reducer/heroic-inspiration-reroll.ts";
import type { BattleEffectExecutionRef } from "./identity.ts";
import {
  charmPersonUnitId,
  commandUnitId,
  viciousMockeryUnitId,
} from "./unit-profile-admission-catalog.test-support.ts";
import {
  requireHole,
  requireResultHole,
} from "./unit-profile-admission-creature-fixture.test-support.ts";
import { spellBattle } from "./unit-profile-admission-spell-battle.test-support.ts";
import {
  savingThrowOutcomeFill,
  spellAct,
  spellTargetFill,
  spellTargetListFill,
} from "./unit-profile-admission-spell-fill.test-support.ts";
import { spellRecord } from "./unit-profile-admission-spell-record.test-support.ts";
import {
  battleUnitRefWithSupportProfiles,
  classLevel,
  spellCasterId,
  spellTargetId,
  unitLibrary,
  type CombatantId,
} from "./unit-profile-admission.test-support.ts";

const countercharmUnitId = "bard_countercharm";

type CountercharmBard = "target" | "caster";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

type CharmPersonOutcome = DistributiveOmit<
  Parameters<typeof savingThrowOutcomeFill>[1][number],
  "targetId"
>;

function single(
  d20: number,
): Extract<BattleD20TestRoll, { readonly tag: "single" }> {
  return { tag: "single", naturalD20: DieRollResult(d20) };
}

function multiple(
  first: number,
  second: number,
  rollMode: "advantage" | "disadvantage",
): Extract<BattleD20TestRoll, { readonly tag: "multiple" }> {
  return {
    tag: "multiple",
    first: DieRollResult(first),
    second: DieRollResult(second),
    rollMode,
  };
}

// Charm Person's target saves with Advantage while the caster fights it.
const charmedRoll = multiple(4, 2, "advantage");

function countercharmBattle(input: {
  readonly bard: CountercharmBard;
  readonly spellId: string;
  readonly heroicInspiration?: HeroicInspiration;
}) {
  const countercharm = unitLibrary.requireUnit(countercharmUnitId);
  const unitRef = battleUnitRefWithSupportProfiles({
    unitRef: { unitId: countercharm.id },
    unit: countercharm,
  });
  if (Result.isFailure(unitRef)) throw new Error(unitRef.failure.message);
  const bardRefs = [unitRef.success];
  const bardFeatures = [
    characterBattleFeatureInitForTest(countercharm, [
      { className: "bard", level: classLevel(7) },
    ]),
  ];
  const bardLevels = [{ className: "bard", level: 7 }] as const;
  return spellBattle({
    ...(input.spellId === viciousMockeryUnitId
      ? { cantrips: [spellRecord(input.spellId)] }
      : { preparedSpells: [spellRecord(input.spellId)] }),
    ...(input.bard === "target"
      ? {
          targetClassLevels: bardLevels,
          targetUnitRefs: bardRefs,
          targetUnitFeatures: bardFeatures,
          ...optionalProperty(
            "targetHeroicInspiration",
            input.heroicInspiration,
          ),
        }
      : {
          casterClassLevels: bardLevels,
          casterSpellcastingSourceClassName: "bard" as const,
          casterUnitRefs: bardRefs,
          casterUnitFeatures: bardFeatures,
        }),
  });
}

function charmPersonSave(
  bard: CountercharmBard = "target",
  heroicInspiration?: HeroicInspiration,
) {
  const session = countercharmBattle({
    bard,
    spellId: charmPersonUnitId,
    ...optionalProperty("heroicInspiration", heroicInspiration),
  });
  const act = spellAct({ session, spellId: charmPersonUnitId });
  const targetFill = spellTargetListFill(
    requireHole(act.initialHoles, "spellTargetList"),
    spellCasterId,
    charmPersonUnitId,
    [spellTargetId],
  );
  const saveHole = requireResultHole(
    resolveBattleSubject({
      state: session.state,
      subject: act.subject,
      fills: [targetFill],
    }),
    "savingThrowOutcome",
  );
  const resolve = (
    state: BattleState,
    outcome: CharmPersonOutcome,
  ): BattleResolutionResult =>
    resolveBattleSubject({
      state,
      subject: act.subject,
      fills: [
        targetFill,
        savingThrowOutcomeFill(saveHole, [
          { targetId: spellTargetId, ...outcome },
        ]),
      ],
    });
  return { state: session.state, saveHole, resolve };
}

function requireNeedsHoles(
  result: BattleResolutionResult,
): Extract<BattleResolutionResult, { readonly tag: "needsHoles" }> {
  if (result.tag !== "needsHoles") {
    throw new Error(
      `Expected holes, got ${result.tag}: ${JSON.stringify(result.tag === "invalid" ? result.message : result.tag)}`,
    );
  }
  return result;
}

function countercharmChoice(
  result: BattleResolutionResult,
): Extract<
  BattleInterruptProcedureChoice,
  { readonly kind: "failedSaveReactionReroll" }
> {
  const pending = battleFrontierInterruptDecisionForState(
    requireNeedsHoles(result).state,
  );
  const choice = pending?.choices.find(
    (
      candidate,
    ): candidate is Extract<
      BattleInterruptProcedureChoice,
      { readonly kind: "failedSaveReactionReroll" }
    > => candidate.kind === "failedSaveReactionReroll",
  );
  if (choice === undefined) {
    throw new Error("Expected the Countercharm choice in the window.");
  }
  return choice;
}

function takeCountercharm(
  result: BattleResolutionResult,
): BattleResolutionResult {
  const state = requireNeedsHoles(result).state;
  const pending = battleFrontierInterruptDecisionForState(state);
  if (pending === null) throw new Error("Expected a Reaction window.");
  const choice = countercharmChoice(result);
  return resolveBattleInterrupt({
    state,
    fill: interruptDecisionFill(pending.decisionHole, {
      kind: "resolve",
      responderId: choice.responderId,
      choice: {
        kind: "failedSaveReactionReroll",
        ...choice.reroll,
        fills: [],
      },
    }),
  });
}

function newRoll(input: {
  readonly responderId: CombatantId;
  readonly succeeded: boolean;
  readonly d20TestRoll: BattleD20TestRoll;
  readonly d20TestRerolls?: BattleRolledOutcomeD20TestRerollDecisions;
}): BattleFailedSaveReactionReroll {
  return {
    effectKind: FAILED_SAVE_REACTION_REROLL_EFFECT_KIND,
    responderId: input.responderId,
    newRoll: {
      succeeded: input.succeeded,
      d20TestRoll: input.d20TestRoll,
      ...optionalProperty("d20TestRerolls", input.d20TestRerolls),
    },
  };
}

function heroicInspirationRerollOfFirstDie(result: {
  readonly succeeded: boolean;
  readonly d20TestRoll: Extract<
    BattleD20TestRoll,
    { readonly tag: "multiple" }
  >;
}) {
  return {
    kind: "rerollRolledDie",
    effectKind: HEROIC_INSPIRATION_REROLL_EFFECT_KIND,
    replacement: { die: "first", result },
  } as const;
}

const declineHeroicInspiration = {
  kind: "decline",
  effectKind: HEROIC_INSPIRATION_REROLL_EFFECT_KIND,
} as const;

function heroicInspirationOf(
  state: BattleState,
  id: CombatantId,
): HeroicInspiration | undefined {
  const creature = state.combatants.get(id);
  return creature?.origin.kind === "character"
    ? creature.origin.heroicInspiration
    : undefined;
}

describe("Countercharm: a Reaction rerolls a failed save against Charmed or Frightened", () => {
  test("the Bard's own failed save against Charm Person offers the Reaction", () => {
    const save = charmPersonSave();
    const interrupted = save.resolve(save.state, {
      succeeded: false,
      d20TestRoll: charmedRoll,
    });

    expect(
      currentInterruptCheckpoint(requireNeedsHoles(interrupted).state),
    ).toMatchObject({
      trigger: "saveFailed",
      appliedConditions: ["charmed"],
    });
    expect(countercharmChoice(interrupted)).toMatchObject({
      responderId: spellTargetId,
      reroll: {
        rollerId: spellTargetId,
        rollerPosition: { kind: "responder" },
      },
    });
  });

  test("taking it spends the Reaction and asks the save's new roll with Advantage", () => {
    const save = charmPersonSave();
    const interrupted = save.resolve(save.state, {
      succeeded: false,
      d20TestRoll: charmedRoll,
    });
    const asked = requireNeedsHoles(takeCountercharm(interrupted));

    expect(asked.state.combatants.get(spellTargetId)?.reactionAvailable).toBe(
      false,
    );
    expect(requireResultHole(asked, "savingThrowOutcome")).toMatchObject({
      failedSaveReactionRerolls: [
        {
          effectKind: FAILED_SAVE_REACTION_REROLL_EFFECT_KIND,
          rollerId: spellTargetId,
          responderId: spellTargetId,
          rollMode: "advantage",
        },
      ],
    });
  });

  test("a new roll that succeeds stands: the Bard is not Charmed", () => {
    const save = charmPersonSave();
    const asked = requireNeedsHoles(
      takeCountercharm(
        save.resolve(save.state, {
          succeeded: false,
          d20TestRoll: charmedRoll,
        }),
      ),
    );
    const resolved = save.resolve(asked.state, {
      succeeded: false,
      d20TestRoll: charmedRoll,
      failedSaveReactionReroll: newRoll({
        responderId: spellTargetId,
        succeeded: true,
        d20TestRoll: multiple(3, 17, "advantage"),
      }),
    });

    expect(resolved).toMatchObject({ tag: "resolved" });
    if (resolved.tag !== "resolved") throw new Error("Expected resolution.");
    expect(
      resolved.state.combatants.get(spellTargetId)?.conditions,
    ).not.toEqual(expect.objectContaining({ charmed: true }));
    expect(currentInterruptCheckpoint(resolved.state)).toBeNull();
  });

  test("a new roll that fails stands too: the Bard is Charmed and the window doesn't reopen", () => {
    const save = charmPersonSave();
    const asked = requireNeedsHoles(
      takeCountercharm(
        save.resolve(save.state, {
          succeeded: false,
          d20TestRoll: charmedRoll,
        }),
      ),
    );
    const resolved = save.resolve(asked.state, {
      succeeded: false,
      d20TestRoll: charmedRoll,
      failedSaveReactionReroll: newRoll({
        responderId: spellTargetId,
        succeeded: false,
        d20TestRoll: multiple(2, 6, "advantage"),
      }),
    });

    expect(resolved).toMatchObject({ tag: "resolved" });
    if (resolved.tag !== "resolved") throw new Error("Expected resolution.");
    expect(resolved.state.combatants.get(spellTargetId)?.conditions).toEqual(
      expect.objectContaining({ charmed: true }),
    );
  });

  test("the new roll must have Advantage", () => {
    const save = charmPersonSave();
    const asked = requireNeedsHoles(
      takeCountercharm(
        save.resolve(save.state, {
          succeeded: false,
          d20TestRoll: charmedRoll,
        }),
      ),
    );

    expect(
      save.resolve(asked.state, {
        succeeded: false,
        d20TestRoll: charmedRoll,
        failedSaveReactionReroll: newRoll({
          responderId: spellTargetId,
          succeeded: true,
          d20TestRoll: single(17),
        }),
      }),
    ).toMatchObject({
      tag: "invalid",
      message: FAILED_SAVE_REACTION_REROLL_MODE_MESSAGE,
    });
  });

  test("a new roll no Reaction granted is refused", () => {
    const save = charmPersonSave();

    expect(
      save.resolve(save.state, {
        succeeded: false,
        d20TestRoll: charmedRoll,
        failedSaveReactionReroll: newRoll({
          responderId: spellTargetId,
          succeeded: true,
          d20TestRoll: multiple(3, 17, "advantage"),
        }),
      }),
    ).toMatchObject({
      tag: "invalid",
      message: FAILED_SAVE_REACTION_REROLL_WITHOUT_GRANT_MESSAGE,
    });
  });

  test("a Bard rerolls another creature's failed save once the table rules it within 30 feet", () => {
    const save = charmPersonSave("caster");
    const interrupted = save.resolve(save.state, {
      succeeded: false,
      d20TestRoll: charmedRoll,
    });

    expect(countercharmChoice(interrupted)).toMatchObject({
      responderId: spellCasterId,
      reroll: {
        rollerId: spellTargetId,
        rollerPosition: { kind: "withinRange", rangeFeet: 30 },
      },
    });
    const asked = requireNeedsHoles(takeCountercharm(interrupted));
    expect(requireResultHole(asked, "savingThrowOutcome")).toMatchObject({
      failedSaveReactionRerolls: [
        { rollerId: spellTargetId, responderId: spellCasterId },
      ],
    });
  });

  test("a failed save against an effect that applies neither condition offers nothing", () => {
    const session = countercharmBattle({
      bard: "target",
      spellId: viciousMockeryUnitId,
    });
    const act = spellAct({ session, spellId: viciousMockeryUnitId });
    const targetSelection = spellTargetFill(
      requireHole(act.initialHoles, "targetChoice"),
      viciousMockeryUnitId,
      spellCasterId,
      spellTargetId,
    );
    const saveHole = requireResultHole(
      resolveBattleSubject({
        state: session.state,
        subject: act.subject,
        fills: [targetSelection],
      }),
      "savingThrowOutcome",
    );
    const result = resolveBattleSubject({
      state: session.state,
      subject: act.subject,
      fills: [
        targetSelection,
        savingThrowOutcomeFill(saveHole, [
          { targetId: spellTargetId, succeeded: false, d20TestRoll: single(4) },
        ]),
      ],
    });

    expect(
      battleFrontierInterruptDecisionForState(requireNeedsHoles(result).state),
    ).toBeNull();
  });
});

describe("Countercharm's new roll is a fresh roll (the table's ruling)", () => {
  test("a Heroic Inspiration the first roll left unspent can reroll the new roll", () => {
    const save = charmPersonSave("target", HEROIC_INSPIRATION_AVAILABLE);
    const firstRoll = {
      succeeded: false,
      d20TestRoll: charmedRoll,
      d20TestRerolls: [declineHeroicInspiration],
    } as const;
    const asked = requireNeedsHoles(
      takeCountercharm(save.resolve(save.state, firstRoll)),
    );
    const resolved = save.resolve(asked.state, {
      ...firstRoll,
      failedSaveReactionReroll: newRoll({
        responderId: spellTargetId,
        succeeded: false,
        d20TestRoll: multiple(2, 6, "advantage"),
        d20TestRerolls: [
          heroicInspirationRerollOfFirstDie({
            succeeded: true,
            d20TestRoll: multiple(18, 6, "advantage"),
          }),
        ],
      }),
    });

    expect(resolved).toMatchObject({ tag: "resolved" });
    if (resolved.tag !== "resolved") throw new Error("Expected resolution.");
    expect(
      resolved.state.combatants.get(spellTargetId)?.conditions,
    ).not.toEqual(expect.objectContaining({ charmed: true }));
    expect(heroicInspirationOf(resolved.state, spellTargetId)).toEqual(
      NO_HEROIC_INSPIRATION,
    );
  });

  test("a Heroic Inspiration spent on the first roll stays spent on the new roll", () => {
    const save = charmPersonSave("target", HEROIC_INSPIRATION_AVAILABLE);
    const firstRoll = {
      succeeded: false,
      d20TestRoll: charmedRoll,
      d20TestRerolls: [
        heroicInspirationRerollOfFirstDie({
          succeeded: false,
          d20TestRoll: multiple(3, 2, "advantage"),
        }),
      ],
    } as const;
    const asked = requireNeedsHoles(
      takeCountercharm(save.resolve(save.state, firstRoll)),
    );

    expect(
      save.resolve(asked.state, {
        ...firstRoll,
        failedSaveReactionReroll: newRoll({
          responderId: spellTargetId,
          succeeded: false,
          d20TestRoll: multiple(2, 6, "advantage"),
          d20TestRerolls: [
            heroicInspirationRerollOfFirstDie({
              succeeded: true,
              d20TestRoll: multiple(18, 6, "advantage"),
            }),
          ],
        }),
      }),
    ).toMatchObject({
      tag: "invalid",
      message: HEROIC_INSPIRATION_REROLL_UNAVAILABLE_MESSAGE,
    });
  });
});

describe("Countercharm's new roll asks its own decisions", () => {
  test("a new roll that fails is asked about its roller's sources, marked as the new roll", () => {
    const save = charmPersonSave("target", HEROIC_INSPIRATION_AVAILABLE);
    const firstRoll = {
      succeeded: false,
      d20TestRoll: charmedRoll,
      d20TestRerolls: [declineHeroicInspiration],
    } as const;
    const asked = requireNeedsHoles(
      takeCountercharm(save.resolve(save.state, firstRoll)),
    );
    const askedAgain = save.resolve(asked.state, {
      ...firstRoll,
      failedSaveReactionReroll: newRoll({
        responderId: spellTargetId,
        succeeded: false,
        d20TestRoll: multiple(2, 6, "advantage"),
      }),
    });

    expect(
      requireResultHole(requireNeedsHoles(askedAgain), "savingThrowOutcome"),
    ).toMatchObject({
      failedSaveReactionRerolls: [
        { rollerId: spellTargetId, responderId: spellTargetId },
      ],
      heroicInspirationRerolls: [
        { effectKind: HEROIC_INSPIRATION_REROLL_EFFECT_KIND },
      ],
    });
  });

  test("taking the Reaction carries no fills: the new roll comes on the save's hole", () => {
    const save = charmPersonSave();
    const interrupted = requireNeedsHoles(
      save.resolve(save.state, { succeeded: false, d20TestRoll: charmedRoll }),
    );
    const pending = battleFrontierInterruptDecisionForState(interrupted.state);
    if (pending === null) throw new Error("Expected a Reaction window.");
    const choice = countercharmChoice(interrupted);
    const decode = Schema.decodeUnknownResult(
      battleInterruptDecisionFillSchema(),
    );
    const decision = (fills: readonly unknown[]) => ({
      kind: "interruptDecision",
      holeId: pending.decisionHole.holeId,
      value: {
        kind: "resolve",
        responderId: choice.responderId,
        choice: { kind: "failedSaveReactionReroll", ...choice.reroll, fills },
      },
    });

    expect(Result.isSuccess(decode(decision([])))).toBe(true);
    expect(
      Result.isFailure(
        decode(
          decision([
            savingThrowOutcomeFill(save.saveHole, [
              {
                targetId: spellTargetId,
                succeeded: true,
                d20TestRoll: charmedRoll,
              },
            ]),
          ]),
        ),
      ),
    ).toBe(true);
  });
});

describe("Countercharm's Advantage meets the save's own roll mode", () => {
  test.each([
    { saveRollMode: undefined, newRollMode: "advantage" },
    { saveRollMode: "advantage", newRollMode: "advantage" },
    { saveRollMode: "disadvantage", newRollMode: "normal" },
    { saveRollMode: "normal", newRollMode: "normal" },
  ] as const)(
    "a save rolled with $saveRollMode gets a new roll with $newRollMode",
    ({ saveRollMode, newRollMode }) => {
      expect(failedSaveReactionRerollRollMode(saveRollMode, "advantage")).toBe(
        newRollMode,
      );
    },
  );
});

// A creature that repeats a save to end a condition, and fails it, fails a
// save against the effect that applies that condition (ASSUMPTIONS.md A71).
type SavingThrowOutcomeHole = Extract<
  BattleHole,
  { readonly kind: "savingThrowOutcome" }
>;

type RepeatSaveFamily =
  | "spellCondition"
  | "countedSpellCondition"
  | "unitFeatureCondition";

type RepeatSaveSpec = {
  readonly family: RepeatSaveFamily;
  readonly condition: Condition;
};

const repeatSave = {
  ability: "wis",
  dc: { kind: "fixed", dc: difficultyClass(13) },
} as const;

const repeatSaveExpiry = {
  kind: "duration",
  durationTicks: elapsedTimeTicks(10),
} as const;

/**
 * The owner under a condition it repeats a save against at the end of each
 * of its turns: a synthetic low-level repeat-save effect with a fixed DC,
 * sourced from the other creature, of the given family.
 */
function withConditionRepeatSave(
  state: BattleState,
  input: RepeatSaveSpec & {
    readonly ownerId: CombatantId;
    readonly sourceId: CombatantId;
  },
): BattleState {
  const allocated = battleStateWithLowLevelSourceOwnedEffectOccurrenceForTest({
    state,
    sourceCombatantId: input.sourceId,
    ownerId: input.ownerId,
    effect: {
      kind: "spellConditionEndTurnSave",
      condition: input.condition,
      conditionHadNonSpellSource: false,
      heightenedSpellTargetDisadvantage: null,
      save: repeatSave,
      expiresAt: repeatSaveExpiry,
    },
  });
  // The low-level boundary allocates only the spell family; the other
  // families take the same source procedure in place of that occurrence.
  const withEffect =
    input.family === "spellCondition"
      ? allocated.state
      : battleStateWithAllocatedEffectForTest({
          state: withoutActiveEffect(
            allocated.state,
            input.ownerId,
            allocated.effectRef,
          ),
          ownerId: input.ownerId,
          effect:
            input.family === "countedSpellCondition"
              ? {
                  kind: "spellConditionCountedEndTurnSave",
                  sourceProcedureRef: allocated.sourceProcedureRef,
                  sourceCombatantId: input.sourceId,
                  condition: input.condition,
                  conditionHadNonSpellSource: false,
                  save: repeatSave,
                  successes: 0,
                  failures: 0,
                  successThreshold: 3,
                  failureThreshold: 3,
                  savingThrowDisadvantageAbility: "str",
                  lockedIn: false,
                  expiresAt: repeatSaveExpiry,
                }
              : {
                  kind: "unitFeatureConditionEndTurnSave",
                  sourceProcedureRef: allocated.sourceProcedureRef,
                  sourceCombatantId: input.sourceId,
                  condition: input.condition,
                  conditionHadNonSpellSource: false,
                  save: repeatSave,
                  expiresAt: repeatSaveExpiry,
                },
        });
  const owner = withEffect.combatants.get(input.ownerId);
  if (owner === undefined) throw new Error("Expected the repeat save's owner.");
  return {
    ...withEffect,
    combatants: new Map(withEffect.combatants).set(
      input.ownerId,
      testBattleCreatureStateWithConditions(
        owner,
        applyCondition(owner.conditions, input.condition),
      ),
    ),
  };
}

function withoutActiveEffect(
  state: BattleState,
  ownerId: CombatantId,
  effectRef: BattleEffectExecutionRef,
): BattleState {
  const owner = state.combatants.get(ownerId);
  if (owner === undefined) throw new Error("Expected the effect's owner.");
  return {
    ...state,
    combatants: new Map(state.combatants).set(ownerId, {
      ...owner,
      activeEffects: owner.activeEffects.filter(
        (effect) => !("effectRef" in effect) || effect.effectRef !== effectRef,
      ),
    }),
  };
}

/**
 * The end of a turn whose ending creature repeats the given saves: the Bard's
 * own turn, or, with "ally", the other creature's turn after the Bard's.
 */
function repeatSaveBattle(
  repeatSaves: readonly (Condition | RepeatSaveSpec)[],
  ender: "bard" | "ally" = "bard",
) {
  const session = countercharmBattle({
    bard: "caster",
    spellId: viciousMockeryUnitId,
  });
  const enderId = ender === "bard" ? spellCasterId : spellTargetId;
  const sourceId = ender === "bard" ? spellTargetId : spellCasterId;
  let state =
    ender === "bard"
      ? session.state
      : requireResolved(
          endTurn({ state: session.state, actorId: spellCasterId }),
        ).state;
  for (const spec of repeatSaves) {
    state = withConditionRepeatSave(state, {
      ...(typeof spec === "string"
        ? { family: "spellCondition" as const, condition: spec }
        : spec),
      ownerId: enderId,
      sourceId,
    });
  }
  const subject: BattleSubject = {
    tag: "runtimeCommand",
    actorId: enderId,
    command: "endTurn",
  };
  const saveHoles = battleResolutionHolesForTest(
    requireNeedsHoles(resolveBattleSubject({ state, subject, fills: [] })),
  ).filter(
    (hole): hole is SavingThrowOutcomeHole =>
      hole.kind === "savingThrowOutcome",
  );
  const resolveEndTurn = (
    current: BattleState,
    outcomes: readonly CharmPersonOutcome[],
  ): BattleResolutionResult =>
    resolveBattleSubject({
      state: current,
      subject,
      fills: saveHoles.map((hole, index) => {
        const outcome = outcomes[index];
        if (outcome === undefined) throw new Error("Expected an outcome.");
        return savingThrowOutcomeFill(hole, [
          { targetId: enderId, ...outcome },
        ]);
      }),
    });
  return { state, saveHoles, endTurn: resolveEndTurn };
}

function requireResolved(
  result: BattleResolutionResult,
): Extract<BattleResolutionResult, { readonly tag: "resolved" }> {
  if (result.tag !== "resolved") {
    throw new Error(
      `Expected resolution, got ${result.tag}: ${result.tag === "invalid" ? result.message : ""}`,
    );
  }
  return result;
}

const failedRepeatSave = {
  succeeded: false,
  d20TestRoll: single(4),
} as const;

function conditionsOf(state: BattleState, id: CombatantId = spellCasterId) {
  return state.combatants.get(id)?.conditions;
}

describe("Countercharm on a repeat save at the end of a turn", () => {
  test("a failed repeat save against Frightened offers the Reaction on that save", () => {
    const battle = repeatSaveBattle(["frightened"]);
    const [saveHole] = battle.saveHoles;
    if (saveHole === undefined) throw new Error("Expected the repeat save.");
    const interrupted = battle.endTurn(battle.state, [failedRepeatSave]);

    expect(
      currentInterruptCheckpoint(requireNeedsHoles(interrupted).state),
    ).toMatchObject({
      trigger: "saveFailed",
      appliedConditions: ["frightened"],
      failedSaveHoleIds: [saveHole.holeId],
    });
    expect(countercharmChoice(interrupted)).toMatchObject({
      responderId: spellCasterId,
      reroll: { rollerId: spellCasterId },
    });
  });

  test("a new roll that succeeds ends Frightened", () => {
    const battle = repeatSaveBattle(["frightened"]);
    const asked = requireNeedsHoles(
      takeCountercharm(battle.endTurn(battle.state, [failedRepeatSave])),
    );

    expect(requireResultHole(asked, "savingThrowOutcome")).toMatchObject({
      failedSaveReactionRerolls: [
        { rollerId: spellCasterId, rollMode: "advantage" },
      ],
    });
    const resolved = battle.endTurn(asked.state, [
      {
        ...failedRepeatSave,
        failedSaveReactionReroll: newRoll({
          responderId: spellCasterId,
          succeeded: true,
          d20TestRoll: multiple(3, 16, "advantage"),
        }),
      },
    ]);

    expect(resolved).toMatchObject({ tag: "resolved" });
    if (resolved.tag !== "resolved") throw new Error("Expected resolution.");
    expect(conditionsOf(resolved.state)).not.toEqual(
      expect.objectContaining({ frightened: true }),
    );
    expect(currentInterruptCheckpoint(resolved.state)).toBeNull();
  });

  test("a new roll that fails keeps Frightened, and the window doesn't reopen", () => {
    const battle = repeatSaveBattle(["frightened"]);
    const asked = requireNeedsHoles(
      takeCountercharm(battle.endTurn(battle.state, [failedRepeatSave])),
    );
    const resolved = battle.endTurn(asked.state, [
      {
        ...failedRepeatSave,
        failedSaveReactionReroll: newRoll({
          responderId: spellCasterId,
          succeeded: false,
          d20TestRoll: multiple(3, 5, "advantage"),
        }),
      },
    ]);

    expect(resolved).toMatchObject({ tag: "resolved" });
    if (resolved.tag !== "resolved") throw new Error("Expected resolution.");
    expect(conditionsOf(resolved.state)).toEqual(
      expect.objectContaining({ frightened: true }),
    );
  });

  test("a repeat save that succeeds, or one against another condition, offers nothing", () => {
    const frightened = repeatSaveBattle(["frightened"]);
    const poisoned = repeatSaveBattle(["poisoned"]);

    expect(
      frightened.endTurn(frightened.state, [
        { succeeded: true, d20TestRoll: single(15) },
      ]),
    ).toMatchObject({ tag: "resolved" });
    expect(poisoned.endTurn(poisoned.state, [failedRepeatSave])).toMatchObject({
      tag: "resolved",
    });
  });

  test("beside a failed repeat save against another condition, the window names the Frightened save", () => {
    const battle = repeatSaveBattle(["poisoned", "frightened"]);
    expect(battle.saveHoles).toHaveLength(2);
    const interrupted = battle.endTurn(battle.state, [
      failedRepeatSave,
      failedRepeatSave,
    ]);
    const checkpoint = currentInterruptCheckpoint(
      requireNeedsHoles(interrupted).state,
    );

    expect(checkpoint).toMatchObject({
      trigger: "saveFailed",
      appliedConditions: ["frightened"],
    });
    const asked = requireNeedsHoles(takeCountercharm(interrupted));
    const rerolledHoles = battleResolutionHolesForTest(asked).filter(
      (hole) =>
        hole.kind === "savingThrowOutcome" &&
        "failedSaveReactionRerolls" in hole &&
        hole.failedSaveReactionRerolls !== undefined,
    );
    expect(rerolledHoles).toHaveLength(1);
    expect(
      checkpoint !== null && "failedSaveHoleIds" in checkpoint
        ? checkpoint.failedSaveHoleIds
        : undefined,
    ).toEqual([rerolledHoles[0]?.holeId]);
  });
  test("a counted repeat save that Countercharm's new roll wins counts as a success", () => {
    const battle = repeatSaveBattle([
      { family: "countedSpellCondition", condition: "frightened" },
    ]);
    const interrupted = battle.endTurn(battle.state, [failedRepeatSave]);
    expect(
      currentInterruptCheckpoint(requireNeedsHoles(interrupted).state),
    ).toMatchObject({
      trigger: "saveFailed",
      appliedConditions: ["frightened"],
    });
    const asked = requireNeedsHoles(takeCountercharm(interrupted));
    const resolved = requireResolved(
      battle.endTurn(asked.state, [
        {
          ...failedRepeatSave,
          failedSaveReactionReroll: newRoll({
            responderId: spellCasterId,
            succeeded: true,
            d20TestRoll: multiple(3, 16, "advantage"),
          }),
        },
      ]),
    );

    expect(resolved.state.combatants.get(spellCasterId)?.activeEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "spellConditionCountedEndTurnSave",
          successes: 1,
          failures: 0,
        }),
      ]),
    );
  });

  test("a Unit feature's failed repeat save against Frightened offers the Reaction", () => {
    const battle = repeatSaveBattle([
      { family: "unitFeatureCondition", condition: "frightened" },
    ]);
    const interrupted = battle.endTurn(battle.state, [failedRepeatSave]);

    expect(
      currentInterruptCheckpoint(requireNeedsHoles(interrupted).state),
    ).toMatchObject({
      trigger: "saveFailed",
      appliedConditions: ["frightened"],
    });
    const asked = requireNeedsHoles(takeCountercharm(interrupted));
    const resolved = requireResolved(
      battle.endTurn(asked.state, [
        {
          ...failedRepeatSave,
          failedSaveReactionReroll: newRoll({
            responderId: spellCasterId,
            succeeded: true,
            d20TestRoll: multiple(3, 16, "advantage"),
          }),
        },
      ]),
    );
    expect(conditionsOf(resolved.state)).not.toEqual(
      expect.objectContaining({ frightened: true }),
    );
  });

  test("a Bard rerolls an ally's failed repeat save at the end of the ally's turn", () => {
    const battle = repeatSaveBattle(["frightened"], "ally");
    const interrupted = battle.endTurn(battle.state, [failedRepeatSave]);

    expect(countercharmChoice(interrupted)).toMatchObject({
      responderId: spellCasterId,
      reroll: {
        rollerId: spellTargetId,
        rollerPosition: { kind: "withinRange", rangeFeet: 30 },
      },
    });
    const asked = requireNeedsHoles(takeCountercharm(interrupted));
    const resolved = requireResolved(
      battle.endTurn(asked.state, [
        {
          ...failedRepeatSave,
          failedSaveReactionReroll: newRoll({
            responderId: spellCasterId,
            succeeded: true,
            d20TestRoll: multiple(3, 16, "advantage"),
          }),
        },
      ]),
    );
    expect(conditionsOf(resolved.state, spellTargetId)).not.toEqual(
      expect.objectContaining({ frightened: true }),
    );
  });

  test("when a command ends the turn, the window replays End Turn after the command's changes", () => {
    // Command (Grovel) makes the Bard fall Prone and end its turn. The window
    // opens on the state with the Bard Prone, so its replay resumes End Turn
    // and the command doesn't apply again.
    const session = countercharmBattle({
      bard: "target",
      spellId: commandUnitId,
    });
    const act = spellAct({ session, spellId: commandUnitId });
    const targetFill = spellTargetListFill(
      requireHole(act.initialHoles, "spellTargetList"),
      spellCasterId,
      commandUnitId,
      [spellTargetId],
    );
    const optionHole = requireHole(
      act.initialHoles,
      "compelledBehaviorOptionChoice",
    );
    const optionFill = {
      kind: "compelledBehaviorOptionChoice",
      holeId: optionHole.holeId,
      value: "grovel",
    } as const;
    const commandSave = requireResultHole(
      resolveBattleSubject({
        state: session.state,
        subject: act.subject,
        fills: [targetFill, optionFill],
      }),
      "savingThrowOutcome",
    );
    const commanded = requireResolved(
      resolveBattleSubject({
        state: session.state,
        subject: act.subject,
        fills: [
          targetFill,
          optionFill,
          savingThrowOutcomeFill(commandSave, [
            { targetId: spellTargetId, succeeded: false, withoutRoll: true },
          ]),
        ],
      }),
    );
    const bardTurn = withConditionRepeatSave(
      requireResolved(
        endTurn({ state: commanded.state, actorId: spellCasterId }),
      ).state,
      {
        family: "spellCondition",
        condition: "frightened",
        ownerId: spellTargetId,
        sourceId: spellCasterId,
      },
    );
    const grovel = discoverBattleActCandidates(bardTurn).find(
      (candidate) =>
        candidate.subject.tag === "runtimeCommand" &&
        candidate.subject.command === "executeCompelledGrovel",
    );
    if (grovel === undefined) throw new Error("Expected the Grovel act.");
    const saveHole = requireResultHole(
      resolveBattleSubject({
        state: bardTurn,
        subject: grovel.subject,
        fills: [],
      }),
      "savingThrowOutcome",
    );
    const grovelWith = (
      state: BattleState,
      outcome: CharmPersonOutcome,
    ): BattleResolutionResult =>
      resolveBattleSubject({
        state,
        subject: grovel.subject,
        fills: [
          savingThrowOutcomeFill(saveHole, [
            { targetId: spellTargetId, ...outcome },
          ]),
        ],
      });
    const interrupted = grovelWith(bardTurn, failedRepeatSave);
    const endTurnSubject: BattleSubject = {
      tag: "runtimeCommand",
      actorId: spellTargetId,
      command: "endTurn",
    };

    expect(
      currentInterruptCheckpoint(requireNeedsHoles(interrupted).state),
    ).toMatchObject({
      trigger: "saveFailed",
      appliedConditions: ["frightened"],
      continuation: { kind: "replay", subject: endTurnSubject },
    });
    const interruptedBard =
      requireNeedsHoles(interrupted).state.combatants.get(spellTargetId);
    expect(interruptedBard?.conditions).toEqual(
      expect.objectContaining({ prone: true }),
    );
    const asked = requireNeedsHoles(takeCountercharm(interrupted));
    const resolved = requireResolved(
      resolveBattleSubject({
        state: asked.state,
        subject: endTurnSubject,
        fills: [
          savingThrowOutcomeFill(saveHole, [
            {
              targetId: spellTargetId,
              ...failedRepeatSave,
              failedSaveReactionReroll: newRoll({
                responderId: spellTargetId,
                succeeded: true,
                d20TestRoll: multiple(3, 16, "advantage"),
              }),
            },
          ]),
        ],
      }),
    );
    expect(conditionsOf(resolved.state, spellTargetId)).toEqual(
      expect.objectContaining({ prone: true }),
    );
    expect(conditionsOf(resolved.state, spellTargetId)).not.toEqual(
      expect.objectContaining({ frightened: true }),
    );
    expect(resolved.state.initiative).not.toEqual(bardTurn.initiative);
  });
});
