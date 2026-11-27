// -*- mode: Bluespec; -*-

module unitFeatureFailedSaveReactionRerollCoreExamples {
  import d20TestCircumstanceCore.* from "./d20-test-circumstance-core"
  import actionTurnProcedures.* from "./action-turn-procedures"
  import unitFeatureFailedSaveReactionRerollCore.* from "./unit-feature-failed-save-reaction-reroll-core"

  pure val noSources: D20TestRollModeSources = {
    advantage: false,
    disadvantage: false,
  }

  // Countercharm's profile: Charmed or Frightened, and Advantage.
  pure val charmedOrFrightenedAdvantage: FailedSaveReactionRerollProfile = {
    answeredConditions: Set(
      SaveEffectCharmedCondition,
      SaveEffectFrightenedCondition,
    ),
    newRollSources: { advantage: true, disadvantage: false },
  }

  pure val failedCharmSave: FailedSave = {
    rolled: true,
    standsFailed: true,
    rollModeSources: noSources,
    rerolledByReaction: false,
  }

  // The responder's own failed save against an effect that charms.
  pure val responderFailsCharm: FailedSaveReactionRerollFacts = {
    hasFeature: true,
    profile: charmedOrFrightenedAdvantage,
    responderTurn: initialTurnProcedureState,
    responderCanReact: true,
    rollerPosition: FailedSaveRollerIsResponder,
    appliedConditions: Set(SaveEffectCharmedCondition),
    save: failedCharmSave,
    decision: FailedSaveReactionRerollDeclined,
  }

  pure def taken(mode: D20TestRollMode, succeeded: bool): FailedSaveReactionRerollDecision =
    FailedSaveReactionRerollTaken({ newRoll: { mode: mode, succeeded: succeeded } })

  run test_responder_failed_save_against_charm_offers_the_reroll_with_advantage = {
    val result = resolveFailedSaveReactionReroll(responderFailsCharm)
    all {
      assert(result.offered),
      assert(result.newRollMode == AdvantageD20TestRoll),
      assert(not(result.invalid)),
    }
  }

  // The core reads every failed save against an effect that applies
  // Frightened alike, whether it first applies the condition or repeats to
  // end it (A71): the failure offers the reroll, and a new roll that succeeds
  // stands as a success. Ending the condition belongs to the effect's owner.
  run test_failed_save_against_frightened_offers_the_reroll_and_a_success_stands = {
    val repeatSave = {
      ...responderFailsCharm,
      appliedConditions: Set(SaveEffectFrightenedCondition),
    }
    val offered = resolveFailedSaveReactionReroll(repeatSave)
    val rerolled = resolveFailedSaveReactionReroll({
      ...repeatSave,
      decision: taken(AdvantageD20TestRoll, true),
    })
    all {
      assert(offered.offered),
      assert(offered.newRollMode == AdvantageD20TestRoll),
      assert(rerolled.admitted),
      assert(not(rerolled.save.standsFailed)),
    }
  }

  run test_successful_new_roll_stands_and_spends_the_reaction = {
    val result = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      decision: taken(AdvantageD20TestRoll, true),
    })
    all {
      assert(result.admitted),
      assert(not(result.invalid)),
      assert(not(result.save.standsFailed)),
      assert(result.save.rerolledByReaction),
      assert(not(result.responderTurn.reactionAvailable)),
    }
  }

  run test_failed_new_roll_stands_too_and_the_window_does_not_reopen = {
    val result = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      decision: taken(AdvantageD20TestRoll, false),
    })
    val again = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      save: result.save,
    })
    all {
      assert(result.admitted),
      assert(result.save.standsFailed),
      assert(not(again.offered)),
    }
  }

  run test_a_second_responder_cannot_reroll_the_same_save = {
    val first = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      decision: taken(AdvantageD20TestRoll, false),
    })
    val second = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      rollerPosition: FailedSaveRollerRuledWithinRange,
      save: first.save,
      decision: taken(AdvantageD20TestRoll, true),
    })
    all {
      assert(not(second.offered)),
      assert(not(second.admitted)),
      assert(second.invalid),
      assert(second.save == first.save),
      assert(second.responderTurn.reactionAvailable),
    }
  }

  run test_a_new_roll_in_the_wrong_mode_is_refused = {
    val result = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      decision: taken(NormalD20TestRoll, true),
    })
    all {
      assert(not(result.admitted)),
      assert(result.invalid),
      assert(result.save == failedCharmSave),
      assert(result.responderTurn.reactionAvailable),
    }
  }

  run test_decline_keeps_the_failed_save_and_the_reaction = {
    val result = resolveFailedSaveReactionReroll(responderFailsCharm)
    all {
      assert(not(result.admitted)),
      assert(not(result.invalid)),
      assert(result.save == failedCharmSave),
      assert(result.responderTurn.reactionAvailable),
    }
  }

  run test_another_creature_ruled_within_range_is_offered = {
    val result = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      rollerPosition: FailedSaveRollerRuledWithinRange,
      appliedConditions: Set(SaveEffectFrightenedCondition),
    })
    assert(result.offered)
  }

  run test_another_creature_ruled_beyond_range_is_not_offered = {
    val result = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      rollerPosition: FailedSaveRollerRuledBeyondRange,
    })
    assert(not(result.offered))
  }

  run test_an_effect_applying_neither_condition_offers_nothing = {
    val restrains = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      appliedConditions: Set(SaveEffectRestrainedCondition),
    })
    val noCondition = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      appliedConditions: Set(),
    })
    all {
      assert(not(restrains.offered)),
      assert(not(noCondition.offered)),
    }
  }

  run test_one_answered_condition_among_others_is_enough = {
    val result = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      appliedConditions: Set(
        SaveEffectCharmedCondition,
        SaveEffectIncapacitatedCondition,
      ),
    })
    assert(result.offered)
  }

  run test_no_offer_without_a_reaction_or_while_barred_from_reacting = {
    val spent = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      responderTurn: spendReaction(initialTurnProcedureState),
    })
    val barred = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      responderCanReact: false,
    })
    val withoutFeature = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      hasFeature: false,
    })
    all {
      assert(not(spent.offered)),
      assert(not(barred.offered)),
      assert(not(withoutFeature.offered)),
    }
  }

  run test_no_offer_on_a_save_that_succeeded_or_failed_without_a_roll = {
    val succeeded = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      save: { ...failedCharmSave, standsFailed: false },
    })
    val withoutRoll = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      save: { ...failedCharmSave, rolled: false },
    })
    all {
      assert(not(succeeded.offered)),
      assert(not(withoutRoll.offered)),
    }
  }

  run test_a_decision_where_nothing_was_offered_is_invalid = {
    val result = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      rollerPosition: FailedSaveRollerRuledBeyondRange,
    })
    assert(result.invalid)
  }

  run test_the_saves_disadvantage_cancels_the_reactions_advantage = {
    val result = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      save: {
        ...failedCharmSave,
        rollModeSources: { advantage: false, disadvantage: true },
      },
      decision: taken(NormalD20TestRoll, true),
    })
    all {
      assert(result.newRollMode == NormalD20TestRoll),
      assert(result.admitted),
    }
  }

  run test_a_save_whose_sources_already_cancelled_stays_normal = {
    val result = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      save: {
        ...failedCharmSave,
        rollModeSources: { advantage: true, disadvantage: true },
      },
    })
    assert(result.newRollMode == NormalD20TestRoll)
  }

  run test_a_save_with_advantage_keeps_advantage = {
    val result = resolveFailedSaveReactionReroll({
      ...responderFailsCharm,
      save: {
        ...failedCharmSave,
        rollModeSources: { advantage: true, disadvantage: false },
      },
    })
    assert(result.newRollMode == AdvantageD20TestRoll)
  }
}
