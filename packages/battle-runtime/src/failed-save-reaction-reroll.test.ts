// Countercharm (SRD 5.2.1 classes.md, Bard, Level 7: Countercharm): "If you
// or a creature within 30 feet of you fails a saving throw against an effect
// that applies the Charmed or Frightened condition, you can take a Reaction
// to cause the save to be rerolled, and the new roll has Advantage."
import { DieRollResult } from "@dnd/shared/types";
import { Result } from "effect";
import { describe, expect, test } from "vitest";

import {
  battleFrontierInterruptDecisionForState,
  characterBattleFeatureInitForTest,
  interruptDecisionFill,
  resolveBattleInterrupt,
  resolveBattleSubject,
  type BattleState,
} from "./battle-runtime.test-support.ts";
import {
  HEROIC_INSPIRATION_AVAILABLE,
  NO_HEROIC_INSPIRATION,
  type HeroicInspiration,
} from "@dnd/shared/game-facts";
import { optionalProperty } from "./optional-property.ts";
import {
  FAILED_SAVE_REACTION_REROLL_EFFECT_KIND,
  HEROIC_INSPIRATION_REROLL_EFFECT_KIND,
  type BattleD20TestRoll,
  type BattleResolutionResult,
  type BattleRolledOutcomeD20TestRerollDecisions,
  type BattleFailedSaveReactionReroll,
  type BattleInterruptProcedureChoice,
} from "./battle-state-execution.ts";
import {
  failedSaveReactionRerollRollMode,
  FAILED_SAVE_REACTION_REROLL_MODE_MESSAGE,
  FAILED_SAVE_REACTION_REROLL_WITHOUT_GRANT_MESSAGE,
} from "./battle-reducer/failed-save-reaction-reroll.ts";
import { currentInterruptCheckpoint } from "./battle-reducer/battle-snapshot.ts";
import { HEROIC_INSPIRATION_REROLL_UNAVAILABLE_MESSAGE } from "./battle-reducer/heroic-inspiration-reroll.ts";
import {
  charmPersonUnitId,
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
