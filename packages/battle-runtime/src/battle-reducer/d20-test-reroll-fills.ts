// KERNEL-COVERAGE: runtime-owner BATTLE.D20_TEST.HEROIC_INSPIRATION_REROLL
// KERNEL-COVERAGE: runtime-owner BATTLE.D20_TEST.FAILED_SAVING_THROW_REROLL
// KERNEL-COVERAGE: runtime-owner BATTLE.D20_TEST.FAILED_D20_TEST_ADDED_DIE
// KERNEL-COVERAGE: runtime-owner BATTLE.D20_TEST.FAILED_SAVE_REACTION_REROLL
// UNIT-PROFILE-COVERAGE: runtime-owner unit-feature.d20-test-natural-one-reroll
// Checks the after-roll decisions on a subject's rolled D20 Test outcomes
// (ability checks, saving throws and Concentration saves) before the subject
// resolves: the rerolls, then the dice added to a test that stands failed. A
// roller who still has a source to decide on is asked the same hole again
// with that option. What the admitted rolls' decisions cost (Heroic
// Inspiration, a use of a failed saving throw reroll, a Bardic Inspiration
// die, a use of a failed ability check resource boost) is spent once, before
// the subject's owners read the rolls that stand.

import {
  d20TestRollMode,
  type AttackRollMode,
} from "@dnd/shared-algebras/runtime-hole-algebra";

import type {
  AdmittedBattleResolutionInput,
  BattleConcentrationSavingThrowHole,
  BattleFill,
  BattleHole,
  BattleOrdinaryHole,
  BattleResolutionResult,
  BattleD20TestRollKey,
  BattleFailedSaveReactionReroll,
  BattleFailedSaveReactionRerollOption,
  BattleGrantedFailedSaveReactionReroll,
  BattleSavingThrowOutcome,
  BattleState,
} from "../battle-state-execution.ts";
import { battleSubjectActorId } from "./creature-state-execution.ts";
import {
  D20_TEST_NATURAL_ONE_REROLL_MODE_MESSAGE,
  D20_TEST_REROLL_DECISION_REQUIRED_MESSAGE,
} from "./d20-test-natural-one-reroll.ts";
import { Match } from "effect";

import {
  abilityCheckAfterRollDecisions,
  abilityCheckHoleAskedAfterRoll,
  battleStateAfterAbilityCheckAfterRollUses,
  battleStateAfterSavingThrowAfterRollUses,
  savingThrowAfterRollDecisions,
  savingThrowHoleAskedAfterRoll,
  type AbilityCheckAfterRollAsk,
  type AbilityCheckAfterRollUses,
  type D20TestAfterRoll,
  type SavingThrowAfterRollAsk,
  type SavingThrowAfterRollUses,
} from "./d20-test-after-roll-decisions.ts";
import { invalidResult } from "./result-helpers.ts";
import type {
  RollRerollFillCheck,
  RollRerollFillCheckInput,
  RollRerollPrefixResolver,
} from "./roll-reroll-fills.ts";
import type { D20TestSpendScope } from "./d20-test-source-spend.ts";
import {
  FAILED_SAVE_REACTION_REROLL_BEFORE_SAVE_STANDS_MESSAGE,
  FAILED_SAVE_REACTION_REROLL_WITHOUT_GRANT_MESSAGE,
  failedSaveReactionRerollIssue,
  failedSaveReactionRerollOption,
  failedSaveReactionRerollRollKey,
  grantedFailedSaveReactionRerollForRoll,
} from "./failed-save-reaction-reroll.ts";

export const D20_TEST_REROLL_ROLLER_REQUIRED_MESSAGE =
  "Concentration Saving Throw after-roll decisions need the discovered hole that names the concentrating creature.";

type D20TestRerollPrefixResolver = RollRerollPrefixResolver;

const D20_TEST_REROLL_DECISION_HOLE_KINDS = [
  "abilityCheck",
  "concentrationSavingThrow",
  "savingThrowOutcome",
  "spellcastingAbilityCheck",
] as const satisfies readonly BattleOrdinaryHole["kind"][];
type D20TestRerollDecisionHoleKind =
  (typeof D20_TEST_REROLL_DECISION_HOLE_KINDS)[number];

type D20TestRerollDecisionHole = Extract<
  BattleOrdinaryHole,
  { readonly kind: D20TestRerollDecisionHoleKind }
>;

/** The hole asked again with what its roller decides next, if it is the hole the ask names. */
function d20TestRerollDecisionHoleAskedAgain(
  hole: D20TestRerollDecisionHole,
  reask: D20TestAfterRollReask,
): BattleOrdinaryHole | undefined {
  if (hole.kind !== reask.holeKind) return undefined;
  if (
    reask.holeKind === "savingThrowOutcome" ||
    reask.holeKind === "concentrationSavingThrow"
  )
    return savingThrowHoleAskedAgain(hole, reask.ask);
  return hole.kind === "abilityCheck" ||
    hole.kind === "spellcastingAbilityCheck"
    ? abilityCheckHoleAskedAfterRoll(hole, reask.ask)
    : undefined;
}

/** A saving throw hole asked again: for its roller's own decisions, or for a Reaction's new roll. */
function savingThrowHoleAskedAgain(
  hole: D20TestRerollDecisionHole,
  ask: Extract<
    D20TestAfterRollReask,
    { readonly holeKind: "savingThrowOutcome" | "concentrationSavingThrow" }
  >["ask"],
): BattleOrdinaryHole | undefined {
  if (ask.stage === "failedSaveReactionReroll")
    return hole.kind === "savingThrowOutcome"
      ? {
          ...(ask.newRollAsk === undefined
            ? hole
            : savingThrowHoleAskedAfterRoll(hole, ask.newRollAsk)),
          failedSaveReactionRerolls: [ask.option],
        }
      : undefined;
  return hole.kind === "savingThrowOutcome" ||
    hole.kind === "concentrationSavingThrow"
    ? savingThrowHoleAskedAfterRoll(hole, ask)
    : undefined;
}

function isD20TestRerollDecisionHole(
  hole: BattleOrdinaryHole,
): hole is D20TestRerollDecisionHole {
  return D20_TEST_REROLL_DECISION_HOLE_KINDS.some((kind) => kind === hole.kind);
}

/**
 * The hole a roller is asked again, with what its roll kind offers next: a
 * saving throw also offers a failed saving throw reroll, and an ability check
 * a failed ability check resource boost.
 */
type D20TestAfterRollReask =
  | {
      readonly holeKind: "abilityCheck" | "spellcastingAbilityCheck";
      readonly ask: AbilityCheckAfterRollAsk;
    }
  | {
      readonly holeKind: "savingThrowOutcome" | "concentrationSavingThrow";
      readonly ask: SavingThrowAfterRollAsk;
    }
  | {
      readonly holeKind: "savingThrowOutcome";
      readonly ask: {
        readonly stage: "failedSaveReactionReroll";
        readonly option: BattleFailedSaveReactionRerollOption;
        /** The new roll's own after-roll decisions, once it is rolled. */
        readonly newRollAsk?: SavingThrowAfterRollAsk;
      };
    };

type D20TestRerollFillValidation =
  | { readonly tag: "invalid"; readonly message: string }
  | {
      readonly tag: "decisionsRequired";
      readonly fillIndex: number;
      readonly holeId: BattleFill["holeId"];
      readonly reask: D20TestAfterRollReask;
      /** The state after the costs the earlier fills' decisions spend. */
      readonly state: BattleState;
    };

type D20TestRerollAbilityCheckHole = Extract<
  BattleHole,
  { readonly kind: "abilityCheck" | "spellcastingAbilityCheck" }
>;

type D20TestRerollSavingThrowOutcomeHole = Extract<
  BattleHole,
  { readonly kind: "savingThrowOutcome" }
>;

type D20TestRerollFillContext = {
  readonly resolutionInput: AdmittedBattleResolutionInput;
  readonly fillIndex: number;
  readonly resolvePrefix: D20TestRerollPrefixResolver;
};

function pendingHolesBeforeFill(
  input: D20TestRerollFillContext,
): readonly BattleHole[] {
  const pending = input.resolvePrefix({
    ...input.resolutionInput,
    fills: input.resolutionInput.fills.slice(0, input.fillIndex),
  });
  if (pending.tag !== "needsHoles") return [];
  return pending.frontier.kind === "holes"
    ? pending.frontier.holes
    : [pending.frontier.decisionHole];
}

function abilityCheckHoleForFill(
  input: D20TestRerollFillContext & {
    readonly fill: Extract<BattleFill, { readonly kind: "abilityCheck" }>;
  },
): D20TestRerollAbilityCheckHole | undefined {
  return pendingHolesBeforeFill(input).find(
    (hole): hole is D20TestRerollAbilityCheckHole =>
      (hole.kind === "abilityCheck" ||
        hole.kind === "spellcastingAbilityCheck") &&
      hole.holeId === input.fill.holeId,
  );
}

function savingThrowOutcomeHoleForFill(
  input: D20TestRerollFillContext & {
    readonly fill: Extract<BattleFill, { readonly kind: "savingThrowOutcome" }>;
  },
): D20TestRerollSavingThrowOutcomeHole | undefined {
  return pendingHolesBeforeFill(input).find(
    (hole): hole is D20TestRerollSavingThrowOutcomeHole =>
      hole.kind === "savingThrowOutcome" && hole.holeId === input.fill.holeId,
  );
}

function concentrationSavingThrowHoleForFill(
  input: D20TestRerollFillContext & {
    readonly fill: Extract<
      BattleFill,
      { readonly kind: "concentrationSavingThrow" }
    >;
  },
): BattleConcentrationSavingThrowHole | undefined {
  return pendingHolesBeforeFill(input).find(
    (hole): hole is BattleConcentrationSavingThrowHole =>
      hole.kind === "concentrationSavingThrow" &&
      hole.holeId === input.fill.holeId,
  );
}

function savingThrowOutcomeRollModeForTarget(
  hole: D20TestRerollSavingThrowOutcomeHole | undefined,
  targetId: BattleSavingThrowOutcome["targetId"],
): AttackRollMode | undefined {
  return hole?.targetRollModes.find(
    (projection) => projection.targetId === targetId,
  )?.rollMode;
}

function savingThrowOutcomeRollModeIssue(input: {
  readonly d20TestRoll: BattleSavingThrowOutcome["d20TestRoll"];
  readonly requiredRollMode: AttackRollMode | undefined;
}): string | null {
  if (input.d20TestRoll === undefined) return null;
  return d20TestRollMode(input.d20TestRoll) ===
    (input.requiredRollMode ?? "normal")
    ? null
    : D20_TEST_NATURAL_ONE_REROLL_MODE_MESSAGE;
}

/** What an admitted roll's after-roll decisions cost, by its roll kind. */
type D20TestRollCheckUses =
  | { readonly kind: "abilityCheck"; readonly uses: AbilityCheckAfterRollUses }
  | { readonly kind: "savingThrow"; readonly uses: SavingThrowAfterRollUses };

/** One rolled D20 Test's check, in the shape the fill validation folds. */
type D20TestRollCheck =
  | { readonly tag: "admitted"; readonly uses: D20TestRollCheckUses }
  | Extract<D20TestRerollFillValidation, { readonly tag: "invalid" }>
  | Omit<
      Extract<
        D20TestRerollFillValidation,
        { readonly tag: "decisionsRequired" }
      >,
      "state"
    >;

type D20TestRollCheckHole = Pick<
  Extract<D20TestRerollFillValidation, { readonly tag: "decisionsRequired" }>,
  "fillIndex" | "holeId"
>;

function abilityCheckRollCheck<Roll>(
  decisions: D20TestAfterRoll<
    Roll,
    AbilityCheckAfterRollAsk,
    AbilityCheckAfterRollUses
  >,
  hole: D20TestRollCheckHole & {
    readonly holeKind: "abilityCheck" | "spellcastingAbilityCheck";
  },
): D20TestRollCheck {
  if (decisions.tag === "resolved")
    return {
      tag: "admitted",
      uses: { kind: "abilityCheck", uses: decisions.uses },
    };
  if (decisions.tag === "invalid")
    return { tag: "invalid", message: decisions.issue };
  return {
    tag: "decisionsRequired",
    fillIndex: hole.fillIndex,
    holeId: hole.holeId,
    reask: { holeKind: hole.holeKind, ask: decisions.ask },
  };
}

function savingThrowRollCheck<Roll>(
  decisions: D20TestAfterRoll<
    Roll,
    SavingThrowAfterRollAsk,
    SavingThrowAfterRollUses
  >,
  hole: D20TestRollCheckHole & {
    readonly holeKind: "savingThrowOutcome" | "concentrationSavingThrow";
  },
): D20TestRollCheck {
  if (decisions.tag === "resolved")
    return {
      tag: "admitted",
      uses: { kind: "savingThrow", uses: decisions.uses },
    };
  if (decisions.tag === "invalid")
    return { tag: "invalid", message: decisions.issue };
  return {
    tag: "decisionsRequired",
    fillIndex: hole.fillIndex,
    holeId: hole.holeId,
    reask: { holeKind: hole.holeKind, ask: decisions.ask },
  };
}

function battleStateAfterRollCheckUses(
  state: BattleState,
  uses: D20TestRollCheckUses,
): BattleState {
  return Match.value(uses).pipe(
    Match.discriminatorsExhaustive("kind")({
      abilityCheck: ({ uses: abilityCheckUses }) =>
        battleStateAfterAbilityCheckAfterRollUses(state, [abilityCheckUses]),
      savingThrow: ({ uses: savingThrowUses }) =>
        battleStateAfterSavingThrowAfterRollUses(state, [savingThrowUses]),
    }),
  );
}

function d20TestRollChecksForFill(
  input: D20TestRerollFillContext & { readonly fill: BattleFill },
): readonly D20TestRollCheck[] {
  const fill = input.fill;
  if (fill.kind === "abilityCheck") {
    return abilityCheckRollChecks({ ...input, fill });
  }
  if (fill.kind === "savingThrowOutcome") {
    return savingThrowOutcomeRollChecks({ ...input, fill });
  }
  if (fill.kind === "concentrationSavingThrow") {
    return concentrationSavingThrowRollChecks({ ...input, fill });
  }
  return [];
}

function abilityCheckRollChecks(
  input: D20TestRerollFillContext & {
    readonly fill: Extract<BattleFill, { readonly kind: "abilityCheck" }>;
  },
): readonly D20TestRollCheck[] {
  const { state, subject } = input.resolutionInput;
  const scope = { kind: "subject", subject } as const;
  const fill = input.fill;
  const hole = abilityCheckHoleForFill({ ...input, fill });
  return [
    abilityCheckRollCheck(
      abilityCheckAfterRollDecisions({
        state,
        scope,
        roll: {
          rollerId: battleSubjectActorId(subject),
          holeId: fill.holeId,
        },
        value: fill.value,
        requiredRollMode:
          hole?.kind === "abilityCheck" ? hole.rollMode : undefined,
        dc: hole?.dc,
      }),
      {
        fillIndex: input.fillIndex,
        holeId: fill.holeId,
        holeKind: hole?.kind ?? "abilityCheck",
      },
    ),
  ];
}

function savingThrowOutcomeRollChecks(
  input: D20TestRerollFillContext & {
    readonly fill: Extract<BattleFill, { readonly kind: "savingThrowOutcome" }>;
  },
): readonly D20TestRollCheck[] {
  const { state, subject } = input.resolutionInput;
  const scope = { kind: "subject", subject } as const;
  const fill = input.fill;
  const hole = savingThrowOutcomeHoleForFill({ ...input, fill });
  const holeRef = {
    fillIndex: input.fillIndex,
    holeId: fill.holeId,
    holeKind: "savingThrowOutcome",
  } as const;
  return fill.value.outcomes.flatMap((outcome): readonly D20TestRollCheck[] => {
    const saveRollMode = savingThrowOutcomeRollModeForTarget(
      hole,
      outcome.targetId,
    );
    const rollModeIssue = savingThrowOutcomeRollModeIssue({
      d20TestRoll: outcome.d20TestRoll,
      requiredRollMode: saveRollMode,
    });
    /* v8 ignore start -- @preserve -- Malformed resolution input: a saving-throw roll whose mode contradicts the discovered target's D20 Test mode. */
    if (rollModeIssue !== null)
      return [{ tag: "invalid", message: rollModeIssue }];
    /* v8 ignore stop -- @preserve */
    const roll = { rollerId: outcome.targetId, holeId: fill.holeId };
    const first = savingThrowAfterRollDecisions({
      state,
      scope,
      roll,
      outcome,
    });
    const grant = grantedFailedSaveReactionRerollForRoll(state, scope, roll);
    const reroll = outcome.failedSaveReactionReroll;
    const standsFailed = first.tag === "resolved" && !first.roll.succeeded;
    if (reroll === undefined && (grant === undefined || !standsFailed))
      return [savingThrowRollCheck(first, holeRef)];
    return failedSaveReactionRerollRollChecks({
      state,
      scope,
      roll,
      first,
      grant,
      reroll,
      saveRollMode,
      holeRef,
    });
  });
}

/**
 * The checks on a saving throw that a Reaction caused to be rerolled: the
 * first roll, which has to stand failed after its roller's own decisions,
 * then the new roll, asked for until the fill gives it. The new roll is a
 * roll of its own (its own key), decided on from the state after the first
 * roll's decisions spent what they cost, so a source spent on the first roll
 * is spent.
 */
function failedSaveReactionRerollRollChecks(input: {
  readonly state: BattleState;
  readonly scope: D20TestSpendScope;
  readonly roll: BattleD20TestRollKey;
  readonly first: ReturnType<
    typeof savingThrowAfterRollDecisions<BattleSavingThrowOutcome>
  >;
  readonly grant: BattleGrantedFailedSaveReactionReroll | undefined;
  readonly reroll: BattleFailedSaveReactionReroll | undefined;
  readonly saveRollMode: AttackRollMode | undefined;
  readonly holeRef: D20TestRollCheckHole & {
    readonly holeKind: "savingThrowOutcome";
  };
}): readonly D20TestRollCheck[] {
  const { first, grant, reroll } = input;
  if (grant === undefined)
    return [
      {
        tag: "invalid",
        message: FAILED_SAVE_REACTION_REROLL_WITHOUT_GRANT_MESSAGE,
      },
    ];
  /* v8 ignore start -- @preserve -- Malformed resolution input: a new roll that comes before the first roll stands failed. */
  if (first.tag === "invalid")
    return [savingThrowRollCheck(first, input.holeRef)];
  if (first.tag !== "resolved" || first.roll.succeeded)
    return [
      {
        tag: "invalid",
        message: FAILED_SAVE_REACTION_REROLL_BEFORE_SAVE_STANDS_MESSAGE,
      },
    ];
  /* v8 ignore stop -- @preserve */
  if (reroll === undefined)
    return [
      {
        tag: "decisionsRequired",
        fillIndex: input.holeRef.fillIndex,
        holeId: input.holeRef.holeId,
        reask: {
          holeKind: "savingThrowOutcome",
          ask: {
            stage: "failedSaveReactionReroll",
            option: failedSaveReactionRerollOption(grant, input.saveRollMode),
          },
        },
      },
    ];
  const issue = failedSaveReactionRerollIssue({
    grant,
    reroll,
    saveRollMode: input.saveRollMode,
  });
  if (issue !== null) return [{ tag: "invalid", message: issue }];
  const newRoll = savingThrowAfterRollDecisions({
    state: battleStateAfterSavingThrowAfterRollUses(input.state, [first.uses]),
    scope: input.scope,
    roll: failedSaveReactionRerollRollKey(input.roll),
    outcome: reroll.newRoll,
  });
  return [
    savingThrowRollCheck(first, input.holeRef),
    newRoll.tag === "decisionsRequired"
      ? {
          tag: "decisionsRequired",
          fillIndex: input.holeRef.fillIndex,
          holeId: input.holeRef.holeId,
          reask: {
            holeKind: "savingThrowOutcome",
            ask: {
              stage: "failedSaveReactionReroll",
              option: failedSaveReactionRerollOption(grant, input.saveRollMode),
              newRollAsk: newRoll.ask,
            },
          },
        }
      : savingThrowRollCheck(newRoll, input.holeRef),
  ];
}

function concentrationSavingThrowRollChecks(
  input: D20TestRerollFillContext & {
    readonly fill: Extract<
      BattleFill,
      { readonly kind: "concentrationSavingThrow" }
    >;
  },
): readonly D20TestRollCheck[] {
  const { state, subject } = input.resolutionInput;
  const scope = { kind: "subject", subject } as const;
  const fill = input.fill;
  const hole = concentrationSavingThrowHoleForFill({ ...input, fill });
  if (hole === undefined) {
    /* v8 ignore start -- @preserve -- Malformed resolution input: after-roll decisions on a Concentration save that the subject never asked for. */
    return fill.value.d20TestRerolls === undefined &&
      fill.value.d20TestAddedDice === undefined
      ? []
      : [
          {
            tag: "invalid",
            message: D20_TEST_REROLL_ROLLER_REQUIRED_MESSAGE,
          },
        ];
    /* v8 ignore stop -- @preserve */
  }
  return [
    savingThrowRollCheck(
      savingThrowAfterRollDecisions({
        state,
        scope,
        roll: { rollerId: hole.combatantId, holeId: fill.holeId },
        outcome: fill.value,
      }),
      {
        fillIndex: input.fillIndex,
        holeId: fill.holeId,
        holeKind: "concentrationSavingThrow",
      },
    ),
  ];
}

/**
 * Checks the after-roll decisions on one fill's rolled D20 Test outcome,
 * from the state after the costs the earlier fills' decisions spend.
 * Settles with the hole asked again while a roller has a source to decide
 * on, or with an invalid result; otherwise admits the fill and gives the
 * state after what its decisions spend.
 */
export function d20TestRerollFillCheck(
  input: RollRerollFillCheckInput,
): RollRerollFillCheck {
  const resolutionInput = { ...input.resolutionInput, state: input.state };
  const fillUses: D20TestRollCheckUses[] = [];
  for (const check of d20TestRollChecksForFill({
    resolutionInput,
    resolvePrefix: input.resolvePrefix,
    fillIndex: input.fillIndex,
    fill: input.fill,
  })) {
    if (check.tag === "decisionsRequired") {
      return {
        tag: "settled",
        result: resolveD20TestRerollDecisionHole({
          resolutionInput: input.resolutionInput,
          resolvePrefix: input.resolvePrefix,
          decision: { ...check, state: input.state },
        }),
      };
    }
    if (check.tag !== "admitted") {
      return {
        tag: "settled",
        result: invalidResult(
          input.resolutionInput.state,
          "invalidFill",
          check.message,
        ),
      };
    }
    fillUses.push(check.uses);
  }
  return {
    tag: "admitted",
    state: fillUses.reduce(battleStateAfterRollCheckUses, input.state),
  };
}

function resolveD20TestRerollDecisionHole(input: {
  readonly resolutionInput: AdmittedBattleResolutionInput;
  readonly decision: Extract<
    D20TestRerollFillValidation,
    { readonly tag: "decisionsRequired" }
  >;
  readonly resolvePrefix: D20TestRerollPrefixResolver;
}): BattleResolutionResult {
  const pending = input.resolvePrefix({
    ...input.resolutionInput,
    state: input.decision.state,
    fills: input.resolutionInput.fills.slice(0, input.decision.fillIndex),
  });
  /* v8 ignore start -- @preserve -- Malformed resolution input: this guard exists only to reject a fill that contradicts the admitted subject's discovered hole contract. */
  if (pending.tag !== "needsHoles" || pending.frontier.kind !== "holes") {
    return invalidResult(
      input.resolutionInput.state,
      "invalidFill",
      D20_TEST_REROLL_DECISION_REQUIRED_MESSAGE,
    );
  }
  /* v8 ignore stop -- @preserve */
  let matched = false;
  const holes = pending.frontier.holes.map((hole): BattleOrdinaryHole => {
    if (!isD20TestRerollDecisionHole(hole)) return hole;
    if (hole.holeId !== input.decision.holeId) return hole;
    const askedAgain = d20TestRerollDecisionHoleAskedAgain(
      hole,
      input.decision.reask,
    );
    if (askedAgain === undefined) return hole;
    matched = true;
    return askedAgain;
  });
  /* v8 ignore start -- @preserve -- Malformed resolution input: this guard exists only to reject a fill that contradicts the admitted subject's discovered hole contract. */
  if (!matched) {
    return invalidResult(
      input.resolutionInput.state,
      "invalidFill",
      D20_TEST_REROLL_DECISION_REQUIRED_MESSAGE,
    );
  }
  /* v8 ignore stop -- @preserve */
  return {
    ...pending,
    frontier: {
      ...pending.frontier,
      holes: [holes[0], ...holes.slice(1)],
    },
  };
}
