import { copyInterruptCheckpointIdentity } from "./interrupt-checkpoint-identity.ts";
import { Match } from "effect";
// KERNEL-COVERAGE: runtime-owner BATTLE.D20_TEST.HEROIC_INSPIRATION_REROLL BATTLE.D20_TEST.FAILED_D20_TEST_ADDED_DIE BATTLE.EQUIPMENT.AMMUNITION_LIFECYCLE BATTLE.ATTACK.THROWN_WEAPON_ATTACK BATTLE.D20_TEST.FAILED_SAVE_REACTION_REROLL
import type { ReadonlyNonEmptyArray } from "@dnd/shared/types";
import { isReadonlyArrayNonEmpty } from "effect/Array";
import type {
  BattleAcceptedSubjectReplayEvidence,
  BattleD20TestRollKey,
  BattleInterruptCheckpoint,
  BattleInterruptedProcedure,
  BattleState,
} from "../battle-state-execution.ts";
import { sameBattleSubject, type BattleSubject } from "../battle-subjects.ts";
import { optionalProperty } from "../optional-property.ts";
import { sameD20TestRollKey } from "./d20-test-roll-key.ts";

type SubjectContinuationPhase = Extract<
  BattleState["subjectResolutionPhase"],
  { readonly kind: "subjectContinuation" }
>;

/** Preserve only metadata owned by this exact subject. */
export function subjectContinuationPhaseFor(
  state: BattleState,
  subject: BattleSubject,
): SubjectContinuationPhase {
  const fresh: SubjectContinuationPhase = {
    kind: "subjectContinuation",
    subject,
  };
  return Match.value(state.subjectResolutionPhase).pipe(
    Match.when({ kind: "subjectSelection" }, () => fresh),
    Match.when({ kind: "subjectContinuation" }, (phase) =>
      sameBattleSubject(phase.subject, subject) ? phase : fresh,
    ),
    Match.exhaustive,
  );
}

/** Project only the accepted roll and attack witnesses owned by a phase or checkpoint. */
export function acceptedSubjectReplayEvidence(
  source: BattleAcceptedSubjectReplayEvidence,
): BattleAcceptedSubjectReplayEvidence {
  return {
    ...optionalProperty(
      "acceptedHeroicInspirationRerolls",
      source.acceptedHeroicInspirationRerolls,
    ),
    ...optionalProperty(
      "acceptedFailedSavingThrowRerolls",
      source.acceptedFailedSavingThrowRerolls,
    ),
    ...optionalProperty(
      "acceptedBardicInspirationDice",
      source.acceptedBardicInspirationDice,
    ),
    ...optionalProperty(
      "acceptedFailedAbilityCheckResourceBoosts",
      source.acceptedFailedAbilityCheckResourceBoosts,
    ),
    ...optionalProperty(
      "grantedFailedSaveReactionRerolls",
      source.grantedFailedSaveReactionRerolls,
    ),
    ...optionalProperty(
      "acceptedAttackAmmunitionSpend",
      source.acceptedAttackAmmunitionSpend,
    ),
    ...optionalProperty(
      "acceptedThrownWeaponRelease",
      source.acceptedThrownWeaponRelease,
    ),
  };
}

/** Freeze the parent's accepted witnesses before a nested subject executes. */
export function checkpointWithAcceptedSubjectReplayEvidence<
  Checkpoint extends BattleInterruptCheckpoint,
>(state: BattleState, frame: Checkpoint): Checkpoint {
  const accepted = acceptedSubjectReplayEvidence(
    subjectContinuationPhaseFor(
      state,
      interruptedProcedureSubject(frame.continuation),
    ),
  );
  if (Object.keys(accepted).length === 0) return frame;
  const checkpoint = {
    ...frame,
    continuation: {
      ...frame.continuation,
      ...accepted,
    },
  };
  copyInterruptCheckpointIdentity(frame, checkpoint);
  return checkpoint;
}

/**
 * A spend record's rolls as the checkpoint froze them, then the rolls this
 * pass of the owner decided after it: a roll the checkpoint never saw (the
 * new roll a Reaction caused) can only have spent its source on this pass.
 */
function rollsWithLaterSpends<Entry extends BattleD20TestRollKey>(
  frozen: ReadonlyNonEmptyArray<Entry> | undefined,
  owner: ReadonlyNonEmptyArray<Entry> | undefined,
): ReadonlyNonEmptyArray<Entry> | undefined {
  const later = (owner ?? []).filter(
    (entry) => !(frozen ?? []).some((roll) => sameD20TestRollKey(roll, entry)),
  );
  const rolls = [...(frozen ?? []), ...later];
  return isReadonlyArrayNonEmpty(rolls) ? rolls : undefined;
}

/** The checkpoint's witnesses, with the costed rolls the owner decided after it froze. */
function continuationReplayEvidence(
  continuation: BattleInterruptedProcedure,
  owner: BattleAcceptedSubjectReplayEvidence,
): BattleAcceptedSubjectReplayEvidence {
  const frozen = acceptedSubjectReplayEvidence(continuation);
  return {
    ...frozen,
    ...optionalProperty(
      "acceptedHeroicInspirationRerolls",
      rollsWithLaterSpends(
        frozen.acceptedHeroicInspirationRerolls,
        owner.acceptedHeroicInspirationRerolls,
      ),
    ),
    ...optionalProperty(
      "acceptedFailedSavingThrowRerolls",
      rollsWithLaterSpends(
        frozen.acceptedFailedSavingThrowRerolls,
        owner.acceptedFailedSavingThrowRerolls,
      ),
    ),
    ...optionalProperty(
      "acceptedBardicInspirationDice",
      rollsWithLaterSpends(
        frozen.acceptedBardicInspirationDice,
        owner.acceptedBardicInspirationDice,
      ),
    ),
    ...optionalProperty(
      "acceptedFailedAbilityCheckResourceBoosts",
      rollsWithLaterSpends(
        frozen.acceptedFailedAbilityCheckResourceBoosts,
        owner.acceptedFailedAbilityCheckResourceBoosts,
      ),
    ),
  };
}

/**
 * Restore the owner's witnesses, never a nested subject's: the checkpoint's,
 * plus the costed rolls the owner decided after the checkpoint froze.
 */
export function stateForSubjectContinuation(
  state: BattleState,
  continuation: BattleInterruptedProcedure,
): BattleState {
  const ownerPhase = subjectContinuationPhaseFor(
    state,
    interruptedProcedureSubject(continuation),
  );
  const {
    acceptedHeroicInspirationRerolls: _previousHeroicInspiration,
    acceptedFailedSavingThrowRerolls: _previousFailedSavingThrowRerolls,
    acceptedBardicInspirationDice: _previousBardicInspirationDice,
    acceptedFailedAbilityCheckResourceBoosts:
      _previousFailedAbilityCheckResourceBoosts,
    grantedFailedSaveReactionRerolls: _previousFailedSaveReactionRerolls,
    acceptedAttackAmmunitionSpend: _previousAmmunition,
    acceptedThrownWeaponRelease: _previousThrow,
    ...phase
  } = ownerPhase;
  return {
    ...state,
    subjectResolutionPhase: {
      ...phase,
      ...continuationReplayEvidence(continuation, ownerPhase),
    },
  };
}

/** The actual subject owns checkpoint metadata, including specialized damage continuations. */
export function interruptedProcedureSubject(
  procedure: BattleInterruptedProcedure,
): BattleSubject {
  return Match.value(procedure).pipe(
    Match.when({ kind: "attackDamage" }, (value) => value.participant),
    Match.whenOr(
      { kind: "replay" },
      { kind: "resolved" },
      { kind: "afterDamageSequence" },
      { kind: "afterDamageSequenceWithPrimaryAttackFollowUp" },
      { kind: "weaponMasteryCleave" },
      { kind: "huntersPreyHordeBreaker" },
      { kind: "movement" },
      { kind: "movementThenAfterDamageSequence" },
      (value) => value.subject,
    ),
    Match.exhaustive,
  );
}
