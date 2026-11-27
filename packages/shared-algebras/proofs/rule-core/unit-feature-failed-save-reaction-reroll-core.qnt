// -*- mode: Bluespec; -*-
// UNIT-PROFILE-COVERAGE: qnt-owner unit-feature.failed-save-reaction-reroll
// KERNEL-COVERAGE: qnt-owner BATTLE.D20_TEST.FAILED_SAVE_REACTION_REROLL

module unitFeatureFailedSaveReactionRerollCore {
  // RAW anchors:
  // - classes.md: Bard, Level 7: Countercharm. "If you or a creature within
  //   30 feet of you fails a saving throw against an effect that applies the
  //   Charmed or Frightened condition, you can take a Reaction to cause the
  //   save to be rerolled, and the new roll has Advantage."
  // - playing-the-game.md: Advantage/Disadvantage. "If circumstances cause a
  //   roll to have both Advantage and Disadvantage, the roll has neither of
  //   them."
  // - rules-glossary.md: Reaction. "Once you take a Reaction, you can't take
  //   another one until the start of your next turn." Incapacitated: "You
  //   can't take any action, Bonus Action, or Reaction."
  // - ASSUMPTIONS.md A71: the Reaction is offered once the save stands failed
  //   after its roller's own rerolls and added dice; the responder picks one
  //   creature whose save failed; the table rules the range; the new roll
  //   is a roll of its own whose mode combines the Reaction's Advantage with
  //   the save's own sources; the new roll stands; a save is rerolled this
  //   way at most once; and a save repeated to end a condition is a save
  //   against the effect that applies it, so its applied conditions are the
  //   ones it keeps on a failure.
  //
  // The feature is a fact of its profile: the conditions it answers and the
  // roll mode source it gives the new roll. The creature whose save failed is
  // the responder itself or one the table rules within the range. A save that
  // failed without a roll has nothing to reroll.
  //
  // The new roll is a fresh D20 Test: the decisions its roller makes on it
  // (rerolls, added dice) belong to their own cores, and this core takes the
  // table's ruling on it as it stands after them. A decision answers an offer,
  // so a decline is invalid too when nothing was offered.
  import d20TestCircumstanceCore.* from "./d20-test-circumstance-core"
  import actionTurnProcedures.* from "./action-turn-procedures"

  // The conditions an effect applies to a creature that fails its save, or,
  // for a save repeated to end them, keeps on it.
  type SaveEffectCondition =
    | SaveEffectBlindedCondition
    | SaveEffectCharmedCondition
    | SaveEffectDeafenedCondition
    | SaveEffectFrightenedCondition
    | SaveEffectGrappledCondition
    | SaveEffectIncapacitatedCondition
    | SaveEffectInvisibleCondition
    | SaveEffectParalyzedCondition
    | SaveEffectPetrifiedCondition
    | SaveEffectPoisonedCondition
    | SaveEffectProneCondition
    | SaveEffectRestrainedCondition
    | SaveEffectStunnedCondition
    | SaveEffectUnconsciousCondition

  type FailedSaveReactionRerollProfile = {
    // The effect must apply at least one of these.
    answeredConditions: Set[SaveEffectCondition],
    // The roll mode source the Reaction gives the new roll.
    newRollSources: D20TestRollModeSources,
  }

  // Where the creature whose save failed is, as the table rules it.
  type FailedSaveRollerPosition =
    | FailedSaveRollerIsResponder
    | FailedSaveRollerRuledWithinRange
    | FailedSaveRollerRuledBeyondRange

  type FailedSave = {
    rolled: bool,
    // The table's ruling on the save as it stands after its roller's own
    // rerolls and added dice.
    standsFailed: bool,
    // The save's own Advantage and Disadvantage sources.
    rollModeSources: D20TestRollModeSources,
    rerolledByReaction: bool,
  }

  type FailedSaveReactionRerollNewRoll = {
    mode: D20TestRollMode,
    // The table's ruling on the new roll as it stands.
    succeeded: bool,
  }

  type FailedSaveReactionRerollDecision =
    | FailedSaveReactionRerollDeclined
    | FailedSaveReactionRerollTaken({ newRoll: FailedSaveReactionRerollNewRoll })

  type FailedSaveReactionRerollFacts = {
    hasFeature: bool,
    profile: FailedSaveReactionRerollProfile,
    responderTurn: TurnProcedureState,
    // Not Incapacitated, nor otherwise barred from taking Reactions.
    responderCanReact: bool,
    rollerPosition: FailedSaveRollerPosition,
    appliedConditions: Set[SaveEffectCondition],
    save: FailedSave,
    decision: FailedSaveReactionRerollDecision,
  }

  type FailedSaveReactionRerollResult = {
    offered: bool,
    newRollMode: D20TestRollMode,
    admitted: bool,
    invalid: bool,
    responderTurn: TurnProcedureState,
    save: FailedSave,
  }

  pure def failedSaveReactionRerollAnswersEffect(
    facts: FailedSaveReactionRerollFacts,
  ): bool =
    facts.appliedConditions.intersect(facts.profile.answeredConditions) != Set()

  pure def failedSaveReactionRerollRollerInRange(
    position: FailedSaveRollerPosition,
  ): bool =
    match position {
      | FailedSaveRollerIsResponder => true
      | FailedSaveRollerRuledWithinRange => true
      | FailedSaveRollerRuledBeyondRange => false
    }

  pure def failedSaveReactionRerollOffered(
    facts: FailedSaveReactionRerollFacts,
  ): bool =
    all {
      facts.hasFeature,
      facts.responderTurn.reactionAvailable,
      facts.responderCanReact,
      failedSaveReactionRerollRollerInRange(facts.rollerPosition),
      failedSaveReactionRerollAnswersEffect(facts),
      facts.save.rolled,
      facts.save.standsFailed,
      not(facts.save.rerolledByReaction),
    }

  // The Reaction's source joins the save's own sources before they cancel.
  pure def failedSaveReactionRerollNewRollSources(
    facts: FailedSaveReactionRerollFacts,
  ): D20TestRollModeSources =
    {
      advantage: facts.save.rollModeSources.advantage or
        facts.profile.newRollSources.advantage,
      disadvantage: facts.save.rollModeSources.disadvantage or
        facts.profile.newRollSources.disadvantage,
    }

  pure def failedSaveReactionRerollNewRollMode(
    facts: FailedSaveReactionRerollFacts,
  ): D20TestRollMode =
    d20TestRollModeFromSources(failedSaveReactionRerollNewRollSources(facts))

  pure def failedSaveReactionRerollAdmitted(
    facts: FailedSaveReactionRerollFacts,
  ): bool =
    all {
      failedSaveReactionRerollOffered(facts),
      match facts.decision {
        | FailedSaveReactionRerollDeclined => false
        | FailedSaveReactionRerollTaken(choice) =>
            choice.newRoll.mode == failedSaveReactionRerollNewRollMode(facts)
      },
    }

  pure def failedSaveReactionRerollTaken(
    decision: FailedSaveReactionRerollDecision,
  ): bool =
    match decision {
      | FailedSaveReactionRerollDeclined => false
      | FailedSaveReactionRerollTaken(_) => true
    }

  // The new roll stands whether it succeeds or fails, and the save is not
  // rerolled this way again.
  pure def failedSaveReactionRerollSaveAfter(
    facts: FailedSaveReactionRerollFacts,
  ): FailedSave =
    match facts.decision {
      | FailedSaveReactionRerollDeclined => facts.save
      | FailedSaveReactionRerollTaken(choice) => {
          ...facts.save,
          standsFailed: not(choice.newRoll.succeeded),
          rollModeSources: failedSaveReactionRerollNewRollSources(facts),
          rerolledByReaction: true,
        }
    }

  pure def resolveFailedSaveReactionReroll(
    facts: FailedSaveReactionRerollFacts,
  ): FailedSaveReactionRerollResult = {
    val offered = failedSaveReactionRerollOffered(facts)
    val admitted = failedSaveReactionRerollAdmitted(facts)
    {
      offered: offered,
      newRollMode: failedSaveReactionRerollNewRollMode(facts),
      admitted: admitted,
      invalid: if (failedSaveReactionRerollTaken(facts.decision))
        not(admitted)
      else not(offered),
      responderTurn: if (admitted)
        spendReaction(facts.responderTurn)
      else facts.responderTurn,
      save: if (admitted)
        failedSaveReactionRerollSaveAfter(facts)
      else facts.save,
    }
  }
}
