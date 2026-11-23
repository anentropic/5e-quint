// KERNEL-COVERAGE: runtime-owner BATTLE.ATTACK.PRONE_TARGET_ROLL_MODE BATTLE.ATTACK.RANGED_CLOSE_COMBAT_ROLL_MODE BATTLE.ATTACK.TARGET_COVER
import { directTargetCover } from "@dnd/shared-algebras/cover-algebra";
import type { CombatantId } from "../identity.ts";
import type {
  BattleAttackExecutionSelection,
  BattleAttackRangeBand,
  BattleState,
  BattleCreatureState,
  BattleTargetSpatialFact,
} from "../battle-state-execution.ts";
import {
  boundAttackExecutionSelectionMatchesOption,
  type SupportedAttackActionOption,
} from "../battle-action-options.ts";
import { attackTargetConstraint } from "./statblock-attacks.ts";
import {
  rangedAttackCloseCombatDisadvantage,
  rangedAttackEnemyProximityQualificationIssue,
  type RangedAttackEnemyProximityScope,
} from "./ranged-attack-close-combat.ts";
import type { CoverType, MovementFeet } from "@dnd/shared/types";
import { thrownWeaponLandingIssue } from "./thrown-weapon-attack.ts";

export function attackExecutionSelectionMatchesOption(
  selection: BattleAttackExecutionSelection,
  attack: SupportedAttackActionOption,
): boolean {
  if (!("procedureRef" in attack)) return false;
  return boundAttackExecutionSelectionMatchesOption(selection, attack);
}

export function attackTargetIsLegal(
  state: BattleState,
  actorId: CombatantId,
  targetId: CombatantId,
  attack: SupportedAttackActionOption,
  facts: readonly BattleTargetSpatialFact[],
): boolean {
  const target = state.combatants.get(targetId);
  return (
    target !== undefined &&
    creatureAttackTargetIsLegal(actorId, target, attack, facts)
  );
}

export function creatureAttackTargetIsLegal(
  actorId: CombatantId,
  target: BattleCreatureState,
  attack: SupportedAttackActionOption,
  facts: readonly BattleTargetSpatialFact[],
): boolean {
  const targetId = target.combatantId;
  const constraint = attackTargetConstraint(attack);
  const distanceFeet = attackTargetDistanceFeet(
    facts,
    actorId,
    targetId,
    attack,
  );
  return (
    actorId !== targetId &&
    distanceFeet !== null &&
    directTargetCover(
      attackTargetStatedCover(facts, actorId, targetId, attack),
    ) !== null &&
    (constraint.kind === "meleeReach"
      ? Number(distanceFeet) <= Number(constraint.reachFeet)
      : attackTargetRangeBand(facts, actorId, targetId, attack) !== null)
  );
}

/** A ranged attack's proximity scope; a melee or unbound attack has none. */
function rangedAttackProximityScope(
  actorId: CombatantId,
  attack: SupportedAttackActionOption,
): RangedAttackEnemyProximityScope | null {
  return attackTargetConstraint(attack).kind === "rangedRange" &&
    "procedureRef" in attack
    ? { attackerId: actorId, procedureRef: attack.procedureRef }
    : null;
}

/** A ranged attack's missing or malformed enemy proximity fact. */
export function attackEnemyProximityQualificationIssue(
  state: BattleState,
  actorId: CombatantId,
  attack: SupportedAttackActionOption,
  facts: readonly BattleTargetSpatialFact[],
): { readonly tag: "invalid"; readonly message: string } | null {
  const scope = rangedAttackProximityScope(actorId, attack);
  return scope === null
    ? null
    : rangedAttackEnemyProximityQualificationIssue({ state, scope, facts });
}

/** Ranged Attacks in Close Combat Disadvantage for a weapon or stat block attack. */
export function attackCloseCombatDisadvantage(
  state: BattleState,
  actorId: CombatantId,
  attack: SupportedAttackActionOption | undefined,
  facts: readonly BattleTargetSpatialFact[],
): boolean {
  const scope =
    attack === undefined ? null : rangedAttackProximityScope(actorId, attack);
  return (
    scope !== null && rangedAttackCloseCombatDisadvantage(state, scope, facts)
  );
}

export function attackTargetRangeBand(
  facts: readonly BattleTargetSpatialFact[],
  actorId: CombatantId,
  targetId: CombatantId,
  attack: SupportedAttackActionOption,
): BattleAttackRangeBand | null {
  if (attackTargetConstraint(attack).kind !== "rangedRange") {
    return null;
  }
  const distanceFeet = attackTargetDistanceFeet(
    facts,
    actorId,
    targetId,
    attack,
  );
  if (distanceFeet === null) return null;
  const constraint = attackTargetConstraint(attack);
  if (constraint.kind !== "rangedRange") return null;
  if (Number(distanceFeet) <= Number(constraint.normalFeet)) return "normal";
  if (Number(distanceFeet) <= Number(constraint.longFeet)) return "long";
  return null;
}

type AttackTargetDistanceFact = Extract<
  BattleTargetSpatialFact,
  { readonly kind: "attackTargetDistance" }
>;

function attackTargetDistanceFact(
  facts: readonly BattleTargetSpatialFact[],
  actorId: CombatantId,
  targetId: CombatantId,
  attack: SupportedAttackActionOption,
): AttackTargetDistanceFact | null {
  for (const fact of facts) {
    if (
      fact.kind === "attackTargetDistance" &&
      fact.actorId === actorId &&
      fact.targetId === targetId &&
      attackExecutionSelectionMatchesOption(fact, attack)
    ) {
      return fact;
    }
  }
  return null;
}

export function attackTargetDistanceFeet(
  facts: readonly BattleTargetSpatialFact[],
  actorId: CombatantId,
  targetId: CombatantId,
  attack: SupportedAttackActionOption,
): MovementFeet | null {
  return (
    attackTargetDistanceFact(facts, actorId, targetId, attack)?.distanceFeet ??
    null
  );
}

/**
 * The degree of cover the table stated between a weapon or Stat Block attacker
 * and a creature target, or undefined when it stated none.
 */
export function attackTargetStatedCover(
  facts: readonly BattleTargetSpatialFact[],
  actorId: CombatantId,
  targetId: CombatantId,
  attack: SupportedAttackActionOption,
): CoverType | undefined {
  return attackTargetDistanceFact(facts, actorId, targetId, attack)?.cover;
}

/**
 * The table's target facts must qualify a ranged attack's enemy proximity,
 * give a thrown weapon its landing, and place the target inside the attack's
 * target constraint.
 */
export function attackTargetFactsIssue(
  state: BattleState,
  attackerId: CombatantId,
  targetId: CombatantId,
  attack: SupportedAttackActionOption,
  targetSpatialFacts: readonly BattleTargetSpatialFact[],
): string | null {
  const proximityIssue = attackEnemyProximityQualificationIssue(
    state,
    attackerId,
    attack,
    targetSpatialFacts,
  );
  if (proximityIssue !== null) return proximityIssue.message;
  const landingIssue = thrownWeaponLandingIssue(
    attackerId,
    attack,
    targetSpatialFacts,
  );
  if (landingIssue !== null) return landingIssue;
  return attackTargetIsLegal(
    state,
    attackerId,
    targetId,
    attack,
    targetSpatialFacts,
  )
    ? null
    : /* v8 ignore next -- @preserve -- Malformed resolution input: this branch rejects fills that contradict the admitted subject's discovered holes or current typed runtime constraints. */
      "Attack target is outside the selected attack's supported target constraint.";
}
