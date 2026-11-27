// KERNEL-COVERAGE: runtime-owner BATTLE.ROLLED_DICE.HEROIC_INSPIRATION_REROLL
// Heroic Inspiration (Rules Glossary): "If you (a player character) have
// Heroic Inspiration, you can expend it to reroll any die immediately after
// rolling it, and you must use the new roll." This owner offers it on the
// dice a subject asks a player character to roll that are theirs (a rolled-
// dice hole that names its roller: a weapon attack's damage, a spell's damage,
// its healing or its Temporary Hit Points), checks the roller's decision, and
// spends it once, before the subject's owners read the dice.
//
// The table rulings it applies are ASSUMPTIONS.md A71: the roller sees the
// dice they roll together, then rerolls one of them; the fill reports each
// die as it stands, so a die floor (Great Weapon Fighting) applies to the
// new face; under Savage Attacker it rerolls a die of either roll before the
// roller picks one; with Empowered Spell it rerolls a die before Empowered
// Spell does, or a die Empowered Spell rerolled.

import { Match } from "effect";

import type {
  AdmittedBattleResolutionInput,
  BattleD20TestRollKey,
  BattleFill,
  BattleHole,
  BattleResolutionResult,
  BattleRolledDiceFill,
  BattleRolledDiceHeroicInspirationHoleFields,
  BattleRolledDiceHeroicInspirationRerollDecision,
  BattleState,
} from "../battle-state-execution.ts";
import type { DieRollResult, ReadonlyNonEmptyArray } from "@dnd/shared/types";
import {
  d20TestSpendGate,
  type D20TestSpendScope,
} from "./d20-test-source-spend.ts";
import {
  battleStateAfterHeroicInspirationReroll,
  d20TestHoleWithHeroicInspirationRerollOption,
  HEROIC_INSPIRATION_REROLL_UNAVAILABLE_MESSAGE,
  heroicInspirationRerollAvailabilityForRoll,
  heroicInspirationUseForRoll,
} from "./heroic-inspiration-reroll.ts";
import { invalidResult } from "./result-helpers.ts";

export const ROLLED_DICE_HEROIC_INSPIRATION_NOT_OFFERED_MESSAGE =
  "Heroic Inspiration reroll is not offered on this roll.";
export const ROLLED_DICE_HEROIC_INSPIRATION_GROUP_MESSAGE =
  "Heroic Inspiration reroll names a die group the roll doesn't have.";
export const ROLLED_DICE_HEROIC_INSPIRATION_SAVAGE_ATTACKER_MESSAGE =
  "Under Savage Attacker, a Heroic Inspiration reroll of a weapon damage die names the Savage Attacker roll it belongs to.";
export const ROLLED_DICE_HEROIC_INSPIRATION_CANDIDATE_MESSAGE =
  "Heroic Inspiration reroll names a Savage Attacker roll the fill doesn't have.";
export const ROLLED_DICE_HEROIC_INSPIRATION_EMPOWERED_SPELL_MESSAGE =
  "Heroic Inspiration reroll names an Empowered Spell die the fill doesn't have.";
export const ROLLED_DICE_HEROIC_INSPIRATION_REPLACEMENT_MESSAGE =
  "The die Heroic Inspiration rerolled must show its replacement face where the decision names it.";

type RolledDiceHeroicInspirationHole = Extract<
  BattleHole,
  { readonly kind: "rolledDice" }
> &
  BattleRolledDiceHeroicInspirationHoleFields;

/** Whether a rolled-dice hole names whose dice it asks for. */
function isRolledDiceHeroicInspirationHole(
  hole: BattleHole,
): hole is RolledDiceHeroicInspirationHole {
  return hole.kind === "rolledDice" && "rollerId" in hole;
}

type RolledDiceRerollPrefixResolver = (
  input: AdmittedBattleResolutionInput,
) => BattleResolutionResult;

/** Where a subject's rolled dice stand before it resolves. */
export type RolledDiceHeroicInspirationRerollFills =
  | { readonly tag: "settled"; readonly result: BattleResolutionResult }
  | {
      readonly tag: "admitted";
      /** The input state after the Heroic Inspiration the admitted rerolls spend. */
      readonly state: BattleState;
    };

/** One rolled-dice fill's check, in the shape the fill fold takes. */
type RolledDiceFillCheck =
  | { readonly tag: "admitted"; readonly state: BattleState }
  | { readonly tag: "settled"; readonly result: BattleResolutionResult };

/**
 * Checks the Heroic Inspiration decision on every rolled-dice fill whose
 * hole names its roller. Settles with the hole asked again while its roller
 * has Heroic Inspiration to decide on, or with an invalid result; otherwise
 * admits the fills and gives the state after what their rerolls spend.
 */
export function resolveRolledDiceHeroicInspirationRerollFills(input: {
  readonly resolutionInput: AdmittedBattleResolutionInput;
  readonly resolvePrefix: RolledDiceRerollPrefixResolver;
}): RolledDiceHeroicInspirationRerollFills {
  // Each fill is checked against the state after the rerolls the earlier
  // fills spend, so a later roll is not offered a spent Heroic Inspiration.
  let state = input.resolutionInput.state;
  for (const [fillIndex, fill] of input.resolutionInput.fills.entries()) {
    if (fill.kind !== "rolledDice") continue;
    const check = rolledDiceFillCheck({ ...input, state, fillIndex, fill });
    if (check.tag === "settled") return check;
    state = check.state;
  }
  return { tag: "admitted", state };
}

function rolledDiceFillCheck(input: {
  readonly resolutionInput: AdmittedBattleResolutionInput;
  readonly resolvePrefix: RolledDiceRerollPrefixResolver;
  readonly state: BattleState;
  readonly fillIndex: number;
  readonly fill: BattleRolledDiceFill;
}): RolledDiceFillCheck {
  const prefixFills = input.resolutionInput.fills.slice(0, input.fillIndex);
  const pending = input.resolvePrefix({
    ...input.resolutionInput,
    state: input.state,
    fills: prefixFills,
  });
  const hole = pendingRolledDiceHole(pending, input.fill);
  if (hole === undefined || !isRolledDiceHeroicInspirationHole(hole)) {
    return input.fill.heroicInspirationReroll === undefined
      ? { tag: "admitted", state: input.state }
      : invalidCheck(
          input.state,
          ROLLED_DICE_HEROIC_INSPIRATION_NOT_OFFERED_MESSAGE,
        );
  }
  return offeredRolledDiceFillCheck({ ...input, prefixFills, pending, hole });
}

/** The check of a fill whose hole names its roller. */
function offeredRolledDiceFillCheck(input: {
  readonly resolutionInput: AdmittedBattleResolutionInput;
  readonly resolvePrefix: RolledDiceRerollPrefixResolver;
  readonly state: BattleState;
  readonly prefixFills: readonly BattleFill[];
  readonly pending: BattleResolutionResult;
  readonly hole: RolledDiceHeroicInspirationHole;
  readonly fill: BattleRolledDiceFill;
}): RolledDiceFillCheck {
  const scope: D20TestSpendScope = {
    kind: "subject",
    subject: input.resolutionInput.subject,
  };
  const roll: BattleD20TestRollKey = {
    rollerId: input.hole.rollerId,
    holeId: input.fill.holeId,
  };
  // The roll's availability reads the state its hole was asked in, so a
  // Heroic Inspiration an owner spent on an earlier roll of the subject (an
  // attack roll's reroll) counts.
  const availability = heroicInspirationRerollAvailabilityForRoll(
    input.pending.tag === "needsHoles" ? input.pending.state : input.state,
    scope,
    roll,
  );
  const decision = input.fill.heroicInspirationReroll;
  if (decision === undefined) {
    return availability === "available"
      ? { tag: "settled", result: holeAskedAgain(input.pending, input.hole) }
      : { tag: "admitted", state: input.state };
  }
  const gate = d20TestSpendGate({
    availability,
    decision,
    unavailableMessage: HEROIC_INSPIRATION_REROLL_UNAVAILABLE_MESSAGE,
  });
  if (gate.tag === "finished")
    return gate.issue === null
      ? { tag: "admitted", state: input.state }
      : invalidCheck(input.state, gate.issue);
  if (decision.kind === "decline")
    return { tag: "admitted", state: input.state };
  return rolledDieRerollCheck({ ...input, decision, scope, roll });
}

/** The check of a reroll the roller may take: where it names its die, and the spend. */
function rolledDieRerollCheck(input: {
  readonly resolutionInput: AdmittedBattleResolutionInput;
  readonly resolvePrefix: RolledDiceRerollPrefixResolver;
  readonly state: BattleState;
  readonly prefixFills: readonly BattleFill[];
  readonly fill: BattleRolledDiceFill;
  readonly decision: RolledDieReroll;
  readonly scope: D20TestSpendScope;
  readonly roll: BattleD20TestRollKey;
}): RolledDiceFillCheck {
  const issue =
    rolledDieRerollIssue(input.fill, input.decision) ??
    asRolledDiceIssue(input);
  if (issue !== null) return invalidCheck(input.state, issue);
  return {
    tag: "admitted",
    state: battleStateAfterHeroicInspirationReroll(
      input.state,
      heroicInspirationUseForRoll({
        state: input.state,
        scope: input.scope,
        roll: input.roll,
        rerolledWithHeroicInspiration: true,
      }),
    ),
  };
}

function invalidCheck(
  state: BattleState,
  message: string,
): RolledDiceFillCheck {
  return {
    tag: "settled",
    result: invalidResult(state, "invalidFill", message),
  };
}

/** The open rolled-dice hole a fill answers, when the frontier has it. */
function pendingRolledDiceHole(
  pending: BattleResolutionResult,
  fill: BattleRolledDiceFill,
): BattleHole | undefined {
  if (pending.tag !== "needsHoles" || pending.frontier.kind !== "holes")
    return undefined;
  return pending.frontier.holes.find(
    (hole) => hole.kind === "rolledDice" && hole.holeId === fill.holeId,
  );
}

/** The pending frontier with the hole asked again with the Heroic Inspiration option. */
function holeAskedAgain(
  pending: BattleResolutionResult,
  asked: RolledDiceHeroicInspirationHole,
): BattleResolutionResult {
  /* v8 ignore next -- @preserve -- pendingRolledDiceHole found the hole on this frontier. */
  if (pending.tag !== "needsHoles" || pending.frontier.kind !== "holes")
    return pending;
  const [first, ...rest] = pending.frontier.holes.map((hole) =>
    hole === asked ? d20TestHoleWithHeroicInspirationRerollOption(asked) : hole,
  );
  /* v8 ignore next -- @preserve -- The frontier holds the asked hole. */
  if (first === undefined) return pending;
  return {
    ...pending,
    frontier: { ...pending.frontier, holes: [first, ...rest] },
  };
}

type RolledDieReroll = Extract<
  BattleRolledDiceHeroicInspirationRerollDecision,
  { readonly kind: "rerollRolledDie" }
>;

/**
 * The issue with where a reroll names its die, if any: the die must be in
 * the fill, showing the replacement face.
 */
function rolledDieRerollIssue(
  fill: BattleRolledDiceFill,
  decision: RolledDieReroll,
): string | null {
  const faces = rolledDieFaces(fill, decision.rolledDie);
  if (typeof faces === "string") return faces;
  return faces.includes(decision.replacement)
    ? null
    : ROLLED_DICE_HEROIC_INSPIRATION_REPLACEMENT_MESSAGE;
}

/** The faces where a reroll names its die, or why it names no die of the fill. */
function rolledDieFaces(
  fill: BattleRolledDiceFill,
  rolledDie: RolledDieReroll["rolledDie"],
): readonly DieRollResult[] | string {
  return Match.value(rolledDie).pipe(
    Match.discriminatorsExhaustive("source")({
      rolledDiceGroup: ({ groupIndex }) => {
        // Group 0 holds the Savage Attacker roll the roller picked, so a
        // reroll of its dice names the roll it belongs to.
        if (fill.weaponDamageDiceRollChoice !== undefined && groupIndex === 0)
          return ROLLED_DICE_HEROIC_INSPIRATION_SAVAGE_ATTACKER_MESSAGE;
        return (
          fill.value[groupIndex]?.results ??
          ROLLED_DICE_HEROIC_INSPIRATION_GROUP_MESSAGE
        );
      },
      weaponDamageDiceRollCandidate: ({ candidate }) => {
        const choice = fill.weaponDamageDiceRollChoice;
        if (choice === undefined)
          return ROLLED_DICE_HEROIC_INSPIRATION_CANDIDATE_MESSAGE;
        return choice.candidates[candidate === "first" ? 0 : 1].results;
      },
      spellDamageReroll: () =>
        fill.spellDamageReroll?.dice.map((die) => die.replacement) ??
        ROLLED_DICE_HEROIC_INSPIRATION_EMPOWERED_SPELL_MESSAGE,
    }),
  );
}

/** The faces with the first die that shows `from` showing `to` instead. */
function withFaceReplaced(
  faces: readonly DieRollResult[],
  from: DieRollResult,
  to: DieRollResult,
): readonly DieRollResult[] {
  const index = faces.indexOf(from);
  return index < 0
    ? faces
    : [...faces.slice(0, index), to, ...faces.slice(index + 1)];
}

/**
 * The fill as rolled, before Heroic Inspiration: the die it rerolled shows
 * the face it replaced. A Savage Attacker roll the roller picked is also the
 * fill's weapon damage group, so both change. A reroll of a die as rolled
 * came before any Empowered Spell reroll, so that roll has none.
 */
function rolledDiceFillAsRolled(
  fill: BattleRolledDiceFill,
  decision: RolledDieReroll,
): BattleRolledDiceFill {
  const { heroicInspirationReroll: _decision, ...withoutDecision } = fill;
  const asRolled = (faces: readonly DieRollResult[]) =>
    withFaceReplaced(faces, decision.replacement, decision.original);
  return Match.value(decision.rolledDie).pipe(
    Match.discriminatorsExhaustive("source")({
      // Heroic Inspiration on a die as rolled comes before Empowered Spell
      // (A71), so the roll before it has no Empowered Spell reroll yet.
      rolledDiceGroup: ({ groupIndex }): BattleRolledDiceFill => {
        const { spellDamageReroll: _later, ...beforeEmpoweredSpell } =
          withoutDecision;
        return {
          ...beforeEmpoweredSpell,
          value: valueWithGroupReplaced(fill.value, groupIndex, asRolled),
        };
      },
      weaponDamageDiceRollCandidate: ({ candidate }): BattleRolledDiceFill => {
        const choice = fill.weaponDamageDiceRollChoice;
        /* v8 ignore next -- @preserve -- rolledDieRerollIssue checked the choice. */
        if (choice === undefined) return withoutDecision;
        const [first, second] = choice.candidates;
        const rerolled = (roll: typeof first): typeof first => ({
          ...roll,
          results: nonEmptyWithFaceReplaced(
            roll.results,
            decision.replacement,
            decision.original,
          ),
        });
        return {
          ...withoutDecision,
          weaponDamageDiceRollChoice: {
            ...choice,
            candidates:
              candidate === "first"
                ? [rerolled(first), second]
                : [first, rerolled(second)],
          },
          value:
            choice.selection === candidate
              ? valueWithGroupReplaced(fill.value, 0, asRolled)
              : fill.value,
        };
      },
      spellDamageReroll: (): BattleRolledDiceFill => {
        const reroll = fill.spellDamageReroll;
        /* v8 ignore next -- @preserve -- rolledDieRerollIssue checked the reroll. */
        if (reroll === undefined) return withoutDecision;
        const index = reroll.dice.findIndex(
          (die) => die.replacement === decision.replacement,
        );
        const [first, ...rest] = reroll.dice.map((die, dieIndex) =>
          dieIndex === index ? { ...die, replacement: decision.original } : die,
        );
        /* v8 ignore next -- @preserve -- The reroll keeps its dice. */
        if (first === undefined) return withoutDecision;
        return {
          ...withoutDecision,
          spellDamageReroll: { ...reroll, dice: [first, ...rest] },
        };
      },
    }),
  );
}

function nonEmptyWithFaceReplaced(
  faces: ReadonlyNonEmptyArray<DieRollResult>,
  from: DieRollResult,
  to: DieRollResult,
): ReadonlyNonEmptyArray<DieRollResult> {
  const [first, ...rest] = faces;
  return first === from
    ? [to, ...rest]
    : [first, ...withFaceReplaced(rest, from, to)];
}

function valueWithGroupReplaced(
  value: BattleRolledDiceFill["value"],
  groupIndex: number,
  change: (faces: readonly DieRollResult[]) => readonly DieRollResult[],
): BattleRolledDiceFill["value"] {
  const [first, ...rest] = value.map((group, index) =>
    index === groupIndex ? { ...group, results: change(group.results) } : group,
  );
  /* v8 ignore next -- @preserve -- Replacing a face keeps the groups. */
  if (first === undefined) return value;
  return [first, ...rest];
}

/**
 * The issue with the dice as rolled, if any: the face Heroic Inspiration
 * replaced must be one the hole's die could show, which the owner of the
 * roll checks as it checks any roll.
 */
function asRolledDiceIssue(input: {
  readonly resolutionInput: AdmittedBattleResolutionInput;
  readonly resolvePrefix: RolledDiceRerollPrefixResolver;
  readonly state: BattleState;
  readonly prefixFills: readonly BattleFill[];
  readonly fill: BattleRolledDiceFill;
  readonly decision: RolledDieReroll;
}): string | null {
  const result = input.resolvePrefix({
    ...input.resolutionInput,
    state: input.state,
    fills: [
      ...input.prefixFills,
      rolledDiceFillAsRolled(input.fill, input.decision),
    ],
  });
  return result.tag === "invalid"
    ? `The roll before Heroic Inspiration: ${result.message}`
    : null;
}
