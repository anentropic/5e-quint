import type { BattleD20TestRollKey } from "../battle-state-execution.ts";

/** Whether two keys name the same roll: its roller, its hole and which attempt it is. */
export function sameD20TestRollKey(
  left: BattleD20TestRollKey,
  right: BattleD20TestRollKey,
): boolean {
  return (
    left.rollerId === right.rollerId &&
    left.holeId === right.holeId &&
    left.attempt === right.attempt
  );
}
