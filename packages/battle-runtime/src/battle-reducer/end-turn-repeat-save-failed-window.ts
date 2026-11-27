// KERNEL-COVERAGE: runtime-owner BATTLE.D20_TEST.FAILED_SAVE_REACTION_REROLL
// UNIT-PROFILE-COVERAGE: runtime-owner unit-feature.failed-save-reaction-reroll
// The save-failed Reaction window for a repeat save at the end of a turn. A
// creature that repeats a save to end a condition, and fails it, fails a
// saving throw against the effect that applies that condition (ASSUMPTIONS.md
// A70), so the window opens as it does for the save that first applied the
// condition. The window names the save's own hole: the turn's other repeat
// saves, against other effects, are not this failure.

import type { Condition } from "@dnd/shared/game-facts";

import type { BattleInterruptTrigger } from "../battle-interrupt-triggers.ts";
import type {
  BattleFill,
  BattleHoleId,
  BattleResolutionInput,
  BattleResolutionResult,
} from "../battle-state-execution.ts";
import type { BattleProcedureExecutionRef, CombatantId } from "../identity.ts";
import { maybeOpenInterruptWindow } from "./interrupt-execution.ts";

type SavingThrowOutcomeFill = Extract<
  BattleFill,
  { readonly kind: "savingThrowOutcome" }
>;

/** One repeat save the ending creature made against an effect that applies a condition. */
export type EndTurnConditionRepeatSave = {
  readonly holeId: BattleHoleId;
  /** The save as it stands, after its roller's own decisions. */
  readonly save: SavingThrowOutcomeFill;
  readonly condition: Condition;
  readonly sourceProcedureRef: BattleProcedureExecutionRef;
};

/**
 * The save-failed window for the first of the ending creature's condition
 * repeat saves that was rolled, stands failed and has a Reaction to answer
 * it; null when none has. A window the replay already handled doesn't open
 * again.
 */
export function endTurnRepeatSaveFailedInterruptWindow(input: {
  readonly resolution: BattleResolutionInput;
  readonly actorId: CombatantId;
  readonly repeatSaves: readonly EndTurnConditionRepeatSave[];
  readonly handledInterruptTrigger: BattleInterruptTrigger | undefined;
}): Extract<BattleResolutionResult, { readonly tag: "needsHoles" }> | null {
  for (const repeatSave of input.repeatSaves) {
    if (!rolledAndFailed(repeatSave.save, input.actorId)) continue;
    const window = maybeOpenInterruptWindow(
      input.resolution.state,
      {
        trigger: "saveFailed",
        failedTargetIds: [input.actorId],
        appliedConditions: [repeatSave.condition],
        failedSaveHoleIds: [repeatSave.holeId],
        sourceProcedureRef: repeatSave.sourceProcedureRef,
        continuation: {
          kind: "replay",
          subject: input.resolution.subject,
          fills: input.resolution.fills,
        },
      },
      input.handledInterruptTrigger,
    );
    if (window !== null) return window;
  }
  return null;
}

function rolledAndFailed(
  save: SavingThrowOutcomeFill,
  actorId: CombatantId,
): boolean {
  return save.value.outcomes.some(
    (outcome) =>
      outcome.targetId === actorId &&
      outcome.withoutRoll !== true &&
      !outcome.succeeded,
  );
}
