// A Reaction that causes a failed saving throw to be rerolled with a roll
// mode (Countercharm, SRD 5.2.1 Bard level 7): "If you or a creature within
// 30 feet of you fails a saving throw against an effect that applies the
// Charmed or Frightened condition, you can take a Reaction to cause the save
// to be rerolled, and the new roll has Advantage."
//
// The save-failed Reaction window offers it to each creature with the
// feature and its Reaction, for each creature the effect's failed save names
// that is the creature itself or one the table rules within range, when the
// effect applies a condition the feature answers. Taking it spends the
// Reaction and keeps a grant on the interrupted subject. The subject's replay
// asks the save's hole again for the new roll, once the save stands failed
// after its roller's own rerolls and added dice. The new roll is a roll of its
// own: its roller may decide on it with any source the first roll left
// unspent. Its outcome stands in place of the failed one.

import { Match } from "effect";
import { append } from "effect/Array";
import {
  d20TestRollMode,
  type AttackRollMode,
} from "@dnd/shared-algebras/runtime-hole-algebra";

import type {
  BattleAcceptedSubjectReplayEvidence,
  BattleD20TestRollKey,
  BattleFailedSaveReactionReroll,
  BattleFailedSaveReactionRerollChoice,
  BattleFailedSaveReactionRerollOption,
  BattleFill,
  BattleGrantedFailedSaveReactionReroll,
  BattleInterruptCheckpoint,
  BattleInterruptCheckpointInput,
  BattleInterruptProcedureChoice,
  BattleInterruptedProcedure,
  BattleState,
} from "../battle-state-execution.ts";
import { FAILED_SAVE_REACTION_REROLL_EFFECT_KIND } from "../battle-state-execution.ts";
import type { UnitFeatureProcedureExecution } from "../character-execution-vocabulary.ts";
import {
  combineD20TestRollMode,
  mechanicalD20TestRollModeSources,
} from "../d20-test-circumstance.ts";
import type { BattleProcedureExecutionRef, CombatantId } from "../identity.ts";
import {
  combatantCanTakeReactions,
  isCharacterBattleCreatureState,
} from "./creature-state-execution.ts";
import type { D20TestSpendScope } from "./d20-test-source-spend.ts";
import { savingThrowOutcomeThatStands } from "./d20-test-rolls-that-stand.ts";
import { subjectContinuationPhaseFor } from "./subject-continuation-phase.ts";

type FailedSavingThrowRerollReactionExecution = Extract<
  UnitFeatureProcedureExecution,
  { readonly kind: "failedSavingThrowRerollReaction" }
>;

type SaveFailedFrame = Extract<
  BattleInterruptCheckpointInput,
  { readonly trigger: "saveFailed" }
>;

type ReplayContinuation = Extract<
  BattleInterruptedProcedure,
  { readonly kind: "replay" }
>;

export const FAILED_SAVE_REACTION_REROLL_LABEL =
  "Reroll the failed saving throw (Reaction)";

export const FAILED_SAVE_REACTION_REROLL_WITHOUT_GRANT_MESSAGE =
  "A saving throw's new roll answers a Reaction that caused it to be rerolled; no Reaction did.";
export const FAILED_SAVE_REACTION_REROLL_BEFORE_SAVE_STANDS_MESSAGE =
  "A Reaction rerolls a saving throw only once it stands failed after its roller's own rerolls and added dice.";
export const FAILED_SAVE_REACTION_REROLL_RESPONDER_MESSAGE =
  "The saving throw's new roll names a creature other than the one that took the Reaction.";
export const FAILED_SAVE_REACTION_REROLL_MODE_MESSAGE =
  "The saving throw's new roll must use the roll mode its hole states.";

/** The key of the new roll a failed save reaction reroll gives a roll. */
export function failedSaveReactionRerollRollKey(
  roll: Pick<BattleD20TestRollKey, "rollerId" | "holeId">,
): BattleD20TestRollKey {
  return {
    rollerId: roll.rollerId,
    holeId: roll.holeId,
    attempt: FAILED_SAVE_REACTION_REROLL_EFFECT_KIND,
  };
}

/**
 * The new roll's mode: the Reaction's Advantage with the save's own roll
 * mode, so a Disadvantage on the save cancels it.
 */
export function failedSaveReactionRerollRollMode(
  saveRollMode: AttackRollMode | undefined,
  grantedRollMode: BattleGrantedFailedSaveReactionReroll["rollMode"],
): AttackRollMode {
  const saveSources = mechanicalD20TestRollModeSources(saveRollMode);
  return combineD20TestRollMode({
    advantage: grantedRollMode === "advantage" || saveSources.advantage,
    disadvantage: saveSources.disadvantage,
  });
}

/** The grant a Reaction kept for this roll on the subject it belongs to, if any. */
export function grantedFailedSaveReactionRerollForRoll(
  state: BattleState,
  scope: D20TestSpendScope,
  roll: BattleD20TestRollKey,
): BattleGrantedFailedSaveReactionReroll | undefined {
  if (roll.attempt !== undefined) return undefined;
  return Match.value(scope).pipe(
    Match.when({ kind: "subject" }, ({ subject }) =>
      (
        subjectContinuationPhaseFor(state, subject)
          .grantedFailedSaveReactionRerolls ?? []
      ).find(
        (grant) =>
          grant.rollerId === roll.rollerId && grant.holeId === roll.holeId,
      ),
    ),
    Match.when({ kind: "oneStep" }, () => undefined),
    Match.exhaustive,
  );
}

/** The new roll a saving throw hole asks for a granted reroll. */
export function failedSaveReactionRerollOption(
  grant: BattleGrantedFailedSaveReactionReroll,
  saveRollMode: AttackRollMode | undefined,
): BattleFailedSaveReactionRerollOption {
  return {
    effectKind: FAILED_SAVE_REACTION_REROLL_EFFECT_KIND,
    label: FAILED_SAVE_REACTION_REROLL_LABEL,
    rollerId: grant.rollerId,
    responderId: grant.responderId,
    rollMode: failedSaveReactionRerollRollMode(saveRollMode, grant.rollMode),
  };
}

/**
 * The issue with the new roll on a granted saving throw, if any: it names the
 * creature that took the Reaction and rolls with the mode the hole states.
 */
export function failedSaveReactionRerollIssue(input: {
  readonly grant: BattleGrantedFailedSaveReactionReroll;
  readonly reroll: BattleFailedSaveReactionReroll;
  readonly saveRollMode: AttackRollMode | undefined;
}): string | null {
  if (input.reroll.responderId !== input.grant.responderId)
    return FAILED_SAVE_REACTION_REROLL_RESPONDER_MESSAGE;
  const rollMode = failedSaveReactionRerollRollMode(
    input.saveRollMode,
    input.grant.rollMode,
  );
  return d20TestRollMode(input.reroll.newRoll.d20TestRoll) === rollMode
    ? null
    : FAILED_SAVE_REACTION_REROLL_MODE_MESSAGE;
}

/** The Reaction rerolls the procedure's feature offers in a save-failed window. */
export function failedSaveReactionRerollChoices(
  state: BattleState,
  frame: BattleInterruptCheckpointInput,
): readonly BattleInterruptProcedureChoice[] {
  if (frame.trigger !== "saveFailed" || frame.continuation.kind !== "replay")
    return [];
  const saveFailed = frame;
  const continuation = frame.continuation;
  return [...state.combatants].flatMap(([responderId, responder]) => {
    if (
      !isCharacterBattleCreatureState(responder) ||
      !combatantCanTakeReactions(responder)
    )
      return [];
    return responder.origin.execution.procedureBindings.flatMap((binding) => {
      const procedure = binding.procedure;
      if (
        procedure.kind !== "unitFeature" ||
        procedure.execution.kind !== "failedSavingThrowRerollReaction"
      )
        return [];
      return failedSaveReactionRerollChoicesForFeature({
        frame: saveFailed,
        continuation,
        responderId,
        procedureRef: binding.procedureRef,
        execution: procedure.execution,
      });
    });
  });
}

function failedSaveReactionRerollChoicesForFeature(input: {
  readonly frame: SaveFailedFrame;
  readonly continuation: ReplayContinuation;
  readonly responderId: CombatantId;
  readonly procedureRef: BattleProcedureExecutionRef;
  readonly execution: FailedSavingThrowRerollReactionExecution;
}): readonly BattleInterruptProcedureChoice[] {
  const trigger = input.execution.reaction.trigger;
  if (
    !input.frame.appliedConditions.some((condition) =>
      trigger.againstEffectApplyingAnyOf.includes(condition),
    )
  )
    return [];
  return input.frame.failedTargetIds.flatMap((rollerId) =>
    rerollableFailedSaveHoleId(input.continuation, rollerId) === undefined
      ? []
      : [
          {
            kind: "failedSaveReactionReroll" as const,
            responderId: input.responderId,
            reroll: {
              procedureRef: input.procedureRef,
              rollerId,
              rollerPosition:
                rollerId === input.responderId
                  ? { kind: "responder" as const }
                  : {
                      kind: "withinRange" as const,
                      rangeFeet: trigger.rangeFeet,
                    },
            },
            initialHoles: [],
          },
        ],
  );
}

type SavingThrowOutcomeFill = Extract<
  BattleFill,
  { readonly kind: "savingThrowOutcome" }
>;

/**
 * The hole of the one saving throw the replay holds for this creature that
 * was rolled and stands failed, with no Reaction reroll granted on it yet.
 * Undefined when there is none, or more than one, so a Reaction never
 * guesses which save it rerolls.
 */
export function rerollableFailedSaveHoleId(
  continuation: ReplayContinuation,
  rollerId: CombatantId,
): SavingThrowOutcomeFill["holeId"] | undefined {
  const holeIds = continuation.fills.flatMap((fill) =>
    fill.kind === "savingThrowOutcome" &&
    fill.value.outcomes.some(
      (outcome) =>
        outcome.targetId === rollerId &&
        outcome.withoutRoll !== true &&
        !savingThrowOutcomeThatStands(outcome).succeeded,
    )
      ? [fill.holeId]
      : [],
  );
  const [holeId, ...others] = holeIds;
  if (holeId === undefined || others.length !== 0) return undefined;
  const alreadyGranted = (
    continuation.grantedFailedSaveReactionRerolls ?? []
  ).some((grant) => grant.rollerId === rollerId && grant.holeId === holeId);
  return alreadyGranted ? undefined : holeId;
}

/**
 * The save-failed checkpoint after a creature took the Reaction: the replay
 * keeps the grant, so it asks the save's new roll.
 */
function checkpointWithFailedSaveReactionReroll(
  frame: Extract<BattleInterruptCheckpoint, { readonly trigger: "saveFailed" }>,
  continuation: ReplayContinuation,
  grant: BattleGrantedFailedSaveReactionReroll,
): Extract<BattleInterruptCheckpoint, { readonly trigger: "saveFailed" }> {
  const existing = continuation.grantedFailedSaveReactionRerolls;
  const granted: NonNullable<
    BattleAcceptedSubjectReplayEvidence["grantedFailedSaveReactionRerolls"]
  > = existing === undefined ? [grant] : append(existing, grant);
  return {
    ...frame,
    continuation: {
      ...continuation,
      grantedFailedSaveReactionRerolls: granted,
    },
  };
}

function sameRollerPosition(
  left: BattleFailedSaveReactionRerollChoice["rollerPosition"],
  right: BattleFailedSaveReactionRerollChoice["rollerPosition"],
): boolean {
  return Match.value(left).pipe(
    Match.discriminatorsExhaustive("kind")({
      responder: () => right.kind === "responder",
      withinRange: ({ rangeFeet }) =>
        right.kind === "withinRange" && right.rangeFeet === rangeFeet,
    }),
  );
}

/** Whether a selection names this Reaction reroll choice. */
export function sameFailedSaveReactionRerollChoice(
  left: BattleFailedSaveReactionRerollChoice,
  right: BattleFailedSaveReactionRerollChoice,
): boolean {
  return (
    left.procedureRef === right.procedureRef &&
    left.rollerId === right.rollerId &&
    sameRollerPosition(left.rollerPosition, right.rollerPosition)
  );
}

/**
 * The save-failed checkpoint after the responder took the selected Reaction,
 * which the window still offers it: the replay keeps the grant for the save
 * the Reaction rerolls. Undefined when the window no longer offers it.
 */
export function checkpointAfterFailedSaveReactionReroll(input: {
  readonly state: BattleState;
  readonly frame: BattleInterruptCheckpoint;
  readonly responderId: CombatantId;
  readonly selection: BattleFailedSaveReactionRerollChoice;
}):
  | Extract<BattleInterruptCheckpoint, { readonly trigger: "saveFailed" }>
  | undefined {
  const frame = input.frame;
  if (frame.trigger !== "saveFailed" || frame.continuation.kind !== "replay")
    return undefined;
  const offered = failedSaveReactionRerollChoices(input.state, frame).some(
    (choice) =>
      choice.kind === "failedSaveReactionReroll" &&
      choice.responderId === input.responderId &&
      sameFailedSaveReactionRerollChoice(choice.reroll, input.selection),
  );
  const holeId = rerollableFailedSaveHoleId(
    frame.continuation,
    input.selection.rollerId,
  );
  const execution = responderFailedSaveReactionRerollExecution(
    input.state,
    input.responderId,
    input.selection.procedureRef,
  );
  if (!offered || holeId === undefined || execution === undefined)
    return undefined;
  return checkpointWithFailedSaveReactionReroll(frame, frame.continuation, {
    rollerId: input.selection.rollerId,
    holeId,
    responderId: input.responderId,
    procedureRef: input.selection.procedureRef,
    rollMode: execution.reaction.reroll.rollMode,
  });
}

function responderFailedSaveReactionRerollExecution(
  state: BattleState,
  responderId: CombatantId,
  procedureRef: BattleProcedureExecutionRef,
): FailedSavingThrowRerollReactionExecution | undefined {
  const responder = state.combatants.get(responderId);
  if (!isCharacterBattleCreatureState(responder)) return undefined;
  const procedure = responder.origin.execution.procedureBindings.find(
    (binding) => binding.procedureRef === procedureRef,
  )?.procedure;
  return procedure?.kind === "unitFeature" &&
    procedure.execution.kind === "failedSavingThrowRerollReaction"
    ? procedure.execution
    : undefined;
}
