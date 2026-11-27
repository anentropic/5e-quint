// -*- mode: Bluespec; -*-

module rolledDiceHeroicInspirationRerollCoreExamples {
  import heroicInspirationRerollCore.* from "./heroic-inspiration-reroll-core"
  import rolledDiceHeroicInspirationRerollCore.* from "./rolled-dice-heroic-inspiration-reroll-core"

  // Fireball's 8d6, seen whole before the roller decides (A71).
  pure val inspiredPool: RolledDicePoolRerollFacts = {
    playerCharacter: true,
    inspiration: HeroicInspirationAvailable,
    dieSize: 6,
    pool: [1, 4, 2, 6, 3, 5, 1, 2],
    decision: RolledDieRerollDeclined,
  }

  run test_reroll_replaces_one_die_and_spends_heroic_inspiration = {
    val result = resolveRolledDicePoolReroll({
      ...inspiredPool,
      decision: RolledDieRerollSelected({ dieIndex: 0, replacement: 6 }),
    })
    all {
      assert(result.admitted),
      assert(not(result.invalid)),
      assert(result.effective == [6, 4, 2, 6, 3, 5, 1, 2]),
      assert(dicePoolTotal(result.effective) == 29),
      assert(result.inspirationAfter == NoHeroicInspiration),
    }
  }

  run test_lower_new_roll_must_still_be_used = {
    val result = resolveRolledDicePoolReroll({
      ...inspiredPool,
      decision: RolledDieRerollSelected({ dieIndex: 3, replacement: 1 }),
    })
    all {
      assert(result.admitted),
      assert(result.effective == [1, 4, 2, 1, 3, 5, 1, 2]),
      assert(result.inspirationAfter == NoHeroicInspiration),
    }
  }

  run test_decline_keeps_dice_and_heroic_inspiration = {
    val result = resolveRolledDicePoolReroll(inspiredPool)
    all {
      assert(not(result.admitted)),
      assert(not(result.invalid)),
      assert(result.effective == inspiredPool.pool),
      assert(result.inspirationAfter == HeroicInspirationAvailable),
    }
  }

  run test_reroll_must_name_a_die_of_the_pool_and_a_face_it_can_show = {
    val outsidePool = resolveRolledDicePoolReroll({
      ...inspiredPool,
      decision: RolledDieRerollSelected({ dieIndex: 8, replacement: 6 }),
    })
    val impossibleFace = resolveRolledDicePoolReroll({
      ...inspiredPool,
      decision: RolledDieRerollSelected({ dieIndex: 0, replacement: 7 }),
    })
    val impossibleRoll = resolveRolledDicePoolReroll({
      ...inspiredPool,
      pool: [9, 4],
      decision: RolledDieRerollSelected({ dieIndex: 0, replacement: 6 }),
    })
    all {
      assert(outsidePool.invalid),
      assert(outsidePool.effective == inspiredPool.pool),
      assert(outsidePool.inspirationAfter == HeroicInspirationAvailable),
      assert(impossibleFace.invalid),
      assert(impossibleRoll.invalid),
      assert(impossibleRoll.effective == [9, 4]),
    }
  }

  run test_reroll_needs_a_player_character_with_heroic_inspiration = {
    val reroll = RolledDieRerollSelected({ dieIndex: 0, replacement: 6 })
    val without = resolveRolledDicePoolReroll({
      ...inspiredPool,
      inspiration: NoHeroicInspiration,
      decision: reroll,
    })
    val monster = resolveRolledDicePoolReroll({
      ...inspiredPool,
      playerCharacter: false,
      decision: reroll,
    })
    all {
      assert(without.invalid),
      assert(without.effective == inspiredPool.pool),
      assert(monster.invalid),
      assert(monster.effective == inspiredPool.pool),
    }
  }

  // Great Weapon Fighting treats the die that stands: a 5 rerolled to a 1
  // counts as a 3.
  run test_great_weapon_fighting_floors_the_die_that_stands = {
    val greataxe = resolveRolledDicePoolReroll({
      ...inspiredPool,
      dieSize: 12,
      pool: [5],
      decision: RolledDieRerollSelected({ dieIndex: 0, replacement: 1 }),
    })
    all {
      assert(greataxe.effective == [1]),
      assert(
        dicePoolTotalWithDieFloor(
          greataxe.effective,
          GREAT_WEAPON_FIGHTING_DIE_FLOOR,
        ) == 3,
      ),
    }
  }

  pure val savageAttack: SavageAttackerRerollFacts = {
    playerCharacter: true,
    inspiration: HeroicInspirationAvailable,
    dieSize: 6,
    firstPool: [1, 2, 6, 3],
    firstDecision: RolledDieRerollDeclined,
    secondPool: [4, 1, 2, 2],
    secondDecision: RolledDieRerollDeclined,
    pick: SavageAttackerFirstRoll,
  }

  // Savage Attacker picks between two whole pools, never the best dice of
  // both.
  run test_savage_attacker_rerolls_a_die_of_the_first_roll = {
    val result = resolveSavageAttackerRerolls({
      ...savageAttack,
      firstDecision: RolledDieRerollSelected({ dieIndex: 0, replacement: 5 }),
    })
    all {
      assert(not(result.invalid)),
      assert(result.first == [5, 2, 6, 3]),
      assert(result.second == [4, 1, 2, 2]),
      assert(result.used == [5, 2, 6, 3]),
      assert(result.inspirationAfter == NoHeroicInspiration),
    }
  }

  run test_savage_attacker_rerolls_the_second_roll_only_if_not_taken_on_the_first = {
    val onSecond = resolveSavageAttackerRerolls({
      ...savageAttack,
      secondDecision: RolledDieRerollSelected({ dieIndex: 1, replacement: 6 }),
      pick: SavageAttackerSecondRoll,
    })
    val onBoth = resolveSavageAttackerRerolls({
      ...savageAttack,
      firstDecision: RolledDieRerollSelected({ dieIndex: 0, replacement: 5 }),
      secondDecision: RolledDieRerollSelected({ dieIndex: 1, replacement: 6 }),
    })
    all {
      assert(not(onSecond.invalid)),
      assert(onSecond.used == [4, 6, 2, 2]),
      assert(onSecond.inspirationAfter == NoHeroicInspiration),
      assert(onBoth.invalid),
      assert(onBoth.second == [4, 1, 2, 2]),
    }
  }

  pure val empoweredBolt: EmpoweredSpellRerollFacts = {
    playerCharacter: true,
    inspiration: HeroicInspirationAvailable,
    dieSize: 8,
    pool: [1, 1],
    beforeEmpoweredSpell: RolledDieRerollDeclined,
    empoweredSpellMaximumDice: 3,
    empoweredSpell: [],
    afterEmpoweredSpell: RolledDieRerollDeclined,
  }

  run test_heroic_inspiration_before_empowered_spell = {
    // Heroic Inspiration turns the first 1 into a 2, and Empowered Spell
    // rerolls that 2 into a 5.
    val result = resolveEmpoweredSpellRerolls({
      ...empoweredBolt,
      beforeEmpoweredSpell: RolledDieRerollSelected({
        dieIndex: 0,
        replacement: 2,
      }),
      empoweredSpell: [{ dieIndex: 0, replacement: 5 }],
    })
    all {
      assert(not(result.invalid)),
      assert(result.effective == [5, 1]),
      assert(result.inspirationAfter == NoHeroicInspiration),
    }
  }

  run test_heroic_inspiration_after_empowered_spell = {
    // Empowered Spell turns the first 1 into a 1 again, and Heroic
    // Inspiration then rerolls it into a 4.
    val result = resolveEmpoweredSpellRerolls({
      ...empoweredBolt,
      empoweredSpell: [{ dieIndex: 0, replacement: 1 }],
      afterEmpoweredSpell: RolledDieRerollSelected({
        dieIndex: 0,
        replacement: 4,
      }),
    })
    all {
      assert(not(result.invalid)),
      assert(result.effective == [4, 1]),
      assert(result.inspirationAfter == NoHeroicInspiration),
    }
  }

  run test_heroic_inspiration_is_taken_at_most_once_with_empowered_spell = {
    val result = resolveEmpoweredSpellRerolls({
      ...empoweredBolt,
      beforeEmpoweredSpell: RolledDieRerollSelected({
        dieIndex: 0,
        replacement: 2,
      }),
      empoweredSpell: [{ dieIndex: 1, replacement: 3 }],
      afterEmpoweredSpell: RolledDieRerollSelected({
        dieIndex: 1,
        replacement: 8,
      }),
    })
    all {
      assert(result.invalid),
      assert(result.effective == [2, 3]),
      assert(result.inspirationAfter == NoHeroicInspiration),
    }
  }
}
