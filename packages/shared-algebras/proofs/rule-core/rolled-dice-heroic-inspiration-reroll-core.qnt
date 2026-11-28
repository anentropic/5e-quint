// -*- mode: Bluespec; -*-
// KERNEL-COVERAGE: qnt-owner BATTLE.ROLLED_DICE.HEROIC_INSPIRATION_REROLL

module rolledDiceHeroicInspirationRerollCore {
  // RAW anchors:
  // - rules-glossary.md: Heroic Inspiration. "If you (a player character)
  //   have Heroic Inspiration, you can expend it to reroll any die
  //   immediately after rolling it, and you must use the new roll."
  // - feats.md: Great Weapon Fighting. "When you roll damage for an attack
  //   you make with a Melee weapon that you are holding with two hands, you
  //   can treat any 1 or 2 on a damage die as a 3."
  // - feats.md: Savage Attacker. "you can roll the weapon's damage dice
  //   twice and use either roll against the target."
  // - classes.md: Empowered Spell. "you can reroll a number of the damage
  //   dice up to your Charisma modifier ... and you must use the new rolls."
  // - ASSUMPTIONS.md A74: the roller sees the dice they roll together (a
  //   pool) before deciding, and rerolls one die of it. Great Weapon
  //   Fighting treats the die that stands after every reroll. Under Savage
  //   Attacker each of the two pools may take the reroll, at most once in
  //   all, before the roller picks a pool. With Empowered Spell the reroll
  //   comes before Empowered Spell, or after it if not taken before; after
  //   it, only a die Empowered Spell just rerolled was rolled immediately
  //   before, so only such a die may take the reroll.
  import heroicInspirationRerollCore.* from "./heroic-inspiration-reroll-core"

  type RolledDieRerollDecision =
    | RolledDieRerollDeclined
    | RolledDieRerollSelected({ dieIndex: int, replacement: int })

  type RolledDicePoolRerollFacts = {
    playerCharacter: bool,
    inspiration: HeroicInspiration,
    dieSize: int,
    // The pool as it stands when the roller decides.
    pool: List[int],
    decision: RolledDieRerollDecision,
  }

  type RolledDicePoolRerollResult = {
    admitted: bool,
    invalid: bool,
    effective: List[int],
    inspirationAfter: HeroicInspiration,
  }

  pure def legalDieFace(dieSize: int, face: int): bool =
    face >= 1 and face <= dieSize

  pure def legalDicePool(dieSize: int, pool: List[int]): bool =
    pool.length() >= 1 and
      pool.foldl(true, (legal, face) => legal and legalDieFace(dieSize, face))

  pure def rolledDieRerollTaken(decision: RolledDieRerollDecision): bool =
    match decision {
      | RolledDieRerollDeclined => false
      | RolledDieRerollSelected(_) => true
    }

  pure def rolledDieRerollAdmitted(facts: RolledDicePoolRerollFacts): bool =
    all {
      facts.playerCharacter,
      facts.inspiration == HeroicInspirationAvailable,
      legalDicePool(facts.dieSize, facts.pool),
      match facts.decision {
        | RolledDieRerollDeclined => false
        | RolledDieRerollSelected(choice) => all {
          choice.dieIndex >= 0,
          choice.dieIndex < facts.pool.length(),
          legalDieFace(facts.dieSize, choice.replacement),
        }
      },
    }

  // One die of the pool rerolled, and the new roll is used, whatever it is.
  pure def resolveRolledDicePoolReroll(
    facts: RolledDicePoolRerollFacts,
  ): RolledDicePoolRerollResult = {
    val admitted = rolledDieRerollAdmitted(facts)
    {
      admitted: admitted,
      invalid: rolledDieRerollTaken(facts.decision) and not(admitted),
      effective: if (admitted)
        match facts.decision {
          | RolledDieRerollDeclined => facts.pool
          | RolledDieRerollSelected(choice) =>
              facts.pool.replaceAt(choice.dieIndex, choice.replacement)
        }
      else facts.pool,
      inspirationAfter: if (admitted)
        NoHeroicInspiration
      else facts.inspiration,
    }
  }

  pure def dicePoolTotal(pool: List[int]): int =
    pool.foldl(0, (total, face) => total + face)

  // Great Weapon Fighting reads the faces that stand after every reroll.
  pure val GREAT_WEAPON_FIGHTING_DIE_FLOOR = 3

  pure def dicePoolTotalWithDieFloor(pool: List[int], floor: int): int =
    pool.foldl(0, (total, face) => total + (if (face < floor) floor else face))

  // Savage Attacker: two pools rolled in turn. Heroic Inspiration may reroll
  // a die of the first pool, or of the second if it was not taken on the
  // first; then the roller uses either pool.
  type SavageAttackerPick = SavageAttackerFirstRoll | SavageAttackerSecondRoll

  type SavageAttackerRerollFacts = {
    playerCharacter: bool,
    inspiration: HeroicInspiration,
    dieSize: int,
    firstPool: List[int],
    firstDecision: RolledDieRerollDecision,
    secondPool: List[int],
    secondDecision: RolledDieRerollDecision,
    pick: SavageAttackerPick,
  }

  type SavageAttackerRerollResult = {
    invalid: bool,
    first: List[int],
    second: List[int],
    used: List[int],
    inspirationAfter: HeroicInspiration,
  }

  pure def resolveSavageAttackerRerolls(
    facts: SavageAttackerRerollFacts,
  ): SavageAttackerRerollResult = {
    val first = resolveRolledDicePoolReroll({
      playerCharacter: facts.playerCharacter,
      inspiration: facts.inspiration,
      dieSize: facts.dieSize,
      pool: facts.firstPool,
      decision: facts.firstDecision,
    })
    val second = resolveRolledDicePoolReroll({
      playerCharacter: facts.playerCharacter,
      inspiration: first.inspirationAfter,
      dieSize: facts.dieSize,
      pool: facts.secondPool,
      decision: facts.secondDecision,
    })
    {
      invalid: first.invalid or second.invalid,
      first: first.effective,
      second: second.effective,
      used: match facts.pick {
        | SavageAttackerFirstRoll => first.effective
        | SavageAttackerSecondRoll => second.effective
      },
      inspirationAfter: second.inspirationAfter,
    }
  }

  // Empowered Spell: after the damage roll, and any Heroic Inspiration on
  // it, the caster rerolls some of the dice and uses the new rolls; Heroic
  // Inspiration not taken before may then reroll one of the dice Empowered
  // Spell just rerolled, as it stands.
  type EmpoweredSpellDieReroll = { dieIndex: int, replacement: int }

  type EmpoweredSpellRerollFacts = {
    playerCharacter: bool,
    inspiration: HeroicInspiration,
    dieSize: int,
    pool: List[int],
    beforeEmpoweredSpell: RolledDieRerollDecision,
    empoweredSpellMaximumDice: int,
    empoweredSpell: List[EmpoweredSpellDieReroll],
    afterEmpoweredSpell: RolledDieRerollDecision,
  }

  type EmpoweredSpellRerollResult = {
    invalid: bool,
    effective: List[int],
    inspirationAfter: HeroicInspiration,
  }

  pure def empoweredSpellRerollLegal(
    dieSize: int,
    pool: List[int],
    maximumDice: int,
    rerolls: List[EmpoweredSpellDieReroll],
  ): bool =
    rerolls.length() <= maximumDice and
      rerolls.foldl(true, (legal, reroll) => all {
        legal,
        reroll.dieIndex >= 0,
        reroll.dieIndex < pool.length(),
        legalDieFace(dieSize, reroll.replacement),
      })

  pure def empoweredSpellApplied(
    pool: List[int],
    rerolls: List[EmpoweredSpellDieReroll],
  ): List[int] =
    rerolls.foldl(pool, (faces, reroll) =>
      faces.replaceAt(reroll.dieIndex, reroll.replacement))

  // A reroll after Empowered Spell names a die Empowered Spell rerolled:
  // that is the die just rolled.
  pure def rerollNamesEmpoweredSpellDie(
    decision: RolledDieRerollDecision,
    rerolls: List[EmpoweredSpellDieReroll],
  ): bool =
    match decision {
      | RolledDieRerollDeclined => true
      | RolledDieRerollSelected(choice) =>
          rerolls.foldl(false, (named, reroll) =>
            named or reroll.dieIndex == choice.dieIndex)
    }

  pure def resolveEmpoweredSpellRerolls(
    facts: EmpoweredSpellRerollFacts,
  ): EmpoweredSpellRerollResult = {
    val before = resolveRolledDicePoolReroll({
      playerCharacter: facts.playerCharacter,
      inspiration: facts.inspiration,
      dieSize: facts.dieSize,
      pool: facts.pool,
      decision: facts.beforeEmpoweredSpell,
    })
    val empoweredLegal = empoweredSpellRerollLegal(
      facts.dieSize,
      before.effective,
      facts.empoweredSpellMaximumDice,
      facts.empoweredSpell,
    )
    val empowered = if (empoweredLegal)
      empoweredSpellApplied(before.effective, facts.empoweredSpell)
    else before.effective
    val afterNamesEmpoweredDie = rerollNamesEmpoweredSpellDie(
      facts.afterEmpoweredSpell,
      facts.empoweredSpell,
    )
    val after = resolveRolledDicePoolReroll({
      playerCharacter: facts.playerCharacter,
      inspiration: before.inspirationAfter,
      dieSize: facts.dieSize,
      pool: empowered,
      decision: if (afterNamesEmpoweredDie)
        facts.afterEmpoweredSpell
      else RolledDieRerollDeclined,
    })
    {
      invalid: before.invalid or not(empoweredLegal) or
        not(afterNamesEmpoweredDie) or after.invalid,
      effective: after.effective,
      inspirationAfter: after.inspirationAfter,
    }
  }
}
