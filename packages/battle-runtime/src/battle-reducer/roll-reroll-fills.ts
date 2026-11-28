// KERNEL-COVERAGE: runtime-owner BATTLE.D20_TEST.HEROIC_INSPIRATION_REROLL
// KERNEL-COVERAGE: runtime-owner BATTLE.ROLLED_DICE.HEROIC_INSPIRATION_REROLL
// Checks the after-roll decisions on a subject's rolls before the subject
// resolves, in the order the rolls were made: its rolled D20 Test outcomes
// (ability checks, saving throws and Concentration saves) and the dice it
// rolls (damage, healing). The rolls share their rollers' sources (one Heroic
// Inspiration), so a roll is checked against the state after what the earlier
// rolls' decisions spend, and an earlier roll keeps its claim on a source a
// later roll would also take. Attack rolls decide in their own route, which
// the prefix resolution of a later roll replays.

import type {
  AdmittedBattleResolutionInput,
  BattleFill,
  BattleResolutionResult,
  BattleState,
} from "../battle-state-execution.ts";
import { d20TestRerollFillCheck } from "./d20-test-reroll-fills.ts";
import { rolledDiceHeroicInspirationRerollFillCheck } from "./rolled-dice-heroic-inspiration-reroll.ts";

/** Resolves a subject's fills up to a roll, to find the hole the roll answers. */
export type RollRerollPrefixResolver = (
  input: AdmittedBattleResolutionInput,
) => BattleResolutionResult;

/** One fill's reroll check, against the state after the earlier fills' costs. */
export type RollRerollFillCheckInput = {
  readonly resolutionInput: AdmittedBattleResolutionInput;
  readonly resolvePrefix: RollRerollPrefixResolver;
  /** The input state after what the earlier fills' decisions spend. */
  readonly state: BattleState;
  readonly fillIndex: number;
  readonly fill: BattleFill;
};

/** Where one fill's roll stands: admitted with what it spends, or settled. */
export type RollRerollFillCheck =
  | { readonly tag: "admitted"; readonly state: BattleState }
  | { readonly tag: "settled"; readonly result: BattleResolutionResult };

/**
 * Checks the after-roll decisions on every roll in the fills, in fill
 * order. Settles with a hole asked again while a roller has a source to
 * decide on, or with an invalid result; otherwise admits the fills and gives
 * the state after what their decisions spend.
 */
export function resolveRollRerollFills(input: {
  readonly resolutionInput: AdmittedBattleResolutionInput;
  readonly resolvePrefix: RollRerollPrefixResolver;
}): RollRerollFillCheck {
  let state = input.resolutionInput.state;
  for (const [fillIndex, fill] of input.resolutionInput.fills.entries()) {
    const check = rollRerollFillCheck({ ...input, state, fillIndex, fill });
    if (check.tag === "settled") return check;
    state = check.state;
  }
  return { tag: "admitted", state };
}

function rollRerollFillCheck(
  input: RollRerollFillCheckInput,
): RollRerollFillCheck {
  const fill = input.fill;
  return fill.kind === "rolledDice"
    ? rolledDiceHeroicInspirationRerollFillCheck({ ...input, fill })
    : d20TestRerollFillCheck(input);
}
