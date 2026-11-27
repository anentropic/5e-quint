// UNIT-PROFILE-COVERAGE: verification-owner:runtime-test unit-feature.failed-save-reaction-reroll
// KERNEL-COVERAGE: parity-witness BATTLE.D20_TEST.FAILED_SAVE_REACTION_REROLL
// UNIT-IDENTITY-EVIDENCE: selected-identity-replay U580-COUNTERCHARM bard_countercharm
// UNIT-IDENTITY-REPLAY: U580-COUNTERCHARM bard_countercharm doOfferFailedSaveReactionReroll
// Countercharm (SRD 5.2.1 classes.md, Bard, Level 7: Countercharm): "If you
// or a creature within 30 feet of you fails a saving throw against an effect
// that applies the Charmed or Frightened condition, you can take a Reaction
// to cause the save to be rerolled, and the new roll has Advantage."
import { defineSelectedIdentityReplayWitness } from "../../battle-runtime/src/selected-identity-witness.test-support.ts";
import { interruptDecisionFill } from "../../battle-runtime/src/battle-runtime.test-support.ts";
import { spellTargetListFill } from "../../battle-runtime/src/unit-profile-admission-spell-fill.test-support.ts";
import { bardCreationAtLevel } from "../../character-creation-runtime/src/bard-feature-sdk.test-support.ts";
import { unitId } from "@dnd/shared/game-facts";
import {
  battleFrontierInterruptDecisionForState,
  combatantId,
  FAILED_SAVE_REACTION_REROLL_EFFECT_KIND,
  resolveBattleInterrupt,
  resolveBattleSubject,
  type BattleInterruptProcedureChoice,
  type BattleResolutionResult,
  type BattleSavingThrowOutcome,
} from "@dnd/battle-runtime";
import { DieRollResult } from "@dnd/shared/types";
import { describe, expect, test } from "vitest";
import {
  battleSessionFromSheets,
  characterSheet,
  levelFiveWizardBuild,
  requireHole,
  requireHoleFromList,
  savingThrowOutcomeFill,
  spellSlotActForProcedure,
  unitLibrary,
} from "./sdk-integration.test-support.ts";

const wizardId = combatantId("wizard-5");
const bardId = combatantId("bard");
const charmPerson = "charm_person";

/** A Wizard 5 casts Charm Person on a real-catalog Bard at `level`. */
function bardUnderCharmPerson(level: 6 | 7) {
  const session = battleSessionFromSheets({
    battleIdText: `battle:bard-${level}-countercharm`,
    characters: [
      characterSheet({
        characterIdText: "character:wizard-5",
        combatantId: wizardId,
        build: levelFiveWizardBuild({ preparedSpells: [unitId(charmPerson)] }),
        initiative: 20,
      }),
      characterSheet({
        characterIdText: `character:bard-${level}`,
        combatantId: bardId,
        build: bardCreationAtLevel(level, unitLibrary).build,
        initiative: 10,
      }),
    ],
    monsters: [],
  });
  const act = spellSlotActForProcedure(
    session,
    charmPerson,
    1,
    "saveGatedCondition",
  );
  const targetFill = spellTargetListFill(
    requireHoleFromList(act.initialHoles, "spellTargetList"),
    wizardId,
    charmPerson,
    [bardId],
  );
  const save = requireHole(
    resolveBattleSubject({
      state: session.state,
      subject: act.subject,
      fills: [targetFill],
    }),
    "savingThrowOutcome",
  );
  return { session, act, targetFill, save };
}

// Charm Person's target saves with Advantage while the caster fights it.
const failedSave = {
  targetId: bardId,
  succeeded: false,
  d20TestRoll: {
    tag: "multiple",
    first: DieRollResult(4),
    second: DieRollResult(2),
    rollMode: "advantage",
  },
} as const;

function failedSaveResult(
  battle: ReturnType<typeof bardUnderCharmPerson>,
): BattleResolutionResult {
  return resolveBattleSubject({
    state: battle.session.state,
    subject: battle.act.subject,
    fills: [
      battle.targetFill,
      savingThrowOutcomeFill(battle.save, [failedSave]),
    ],
  });
}

function countercharmChoices(
  result: BattleResolutionResult,
): readonly Extract<
  BattleInterruptProcedureChoice,
  { readonly kind: "failedSaveReactionReroll" }
>[] {
  if (result.tag !== "needsHoles") return [];
  return (
    battleFrontierInterruptDecisionForState(result.state)?.choices ?? []
  ).flatMap((choice) =>
    choice.kind === "failedSaveReactionReroll" ? [choice] : [],
  );
}

const newRollSucceeds: BattleSavingThrowOutcome = {
  ...failedSave,
  failedSaveReactionReroll: {
    effectKind: FAILED_SAVE_REACTION_REROLL_EFFECT_KIND,
    responderId: bardId,
    newRoll: {
      succeeded: true,
      d20TestRoll: {
        tag: "multiple",
        first: DieRollResult(17),
        second: DieRollResult(3),
        rollMode: "advantage",
      },
    },
  } as const,
};

describe("Bard Countercharm real-catalog SDK handoff", () => {
  test("a Bard 7 who fails a Charm Person save is offered Countercharm, and its new roll with Advantage stands", () => {
    const battle = bardUnderCharmPerson(7);
    const { session, act, targetFill, save } = battle;
    const failed = failedSaveResult(battle);
    const [choice, ...others] = countercharmChoices(failed);
    expect(others).toEqual([]);
    expect(choice).toMatchObject({
      responderId: bardId,
      reroll: { rollerId: bardId, rollerPosition: { kind: "responder" } },
    });
    if (failed.tag !== "needsHoles" || choice === undefined)
      throw new Error("Expected the Countercharm choice.");
    const pending = battleFrontierInterruptDecisionForState(failed.state);
    if (pending === null) throw new Error("Expected a Reaction window.");
    const taken = resolveBattleInterrupt({
      state: failed.state,
      fill: interruptDecisionFill(pending.decisionHole, {
        kind: "resolve",
        responderId: choice.responderId,
        choice: {
          kind: "failedSaveReactionReroll",
          ...choice.reroll,
          fills: [],
        },
      }),
    });
    expect(requireHole(taken, "savingThrowOutcome")).toMatchObject({
      failedSaveReactionRerolls: [
        {
          effectKind: FAILED_SAVE_REACTION_REROLL_EFFECT_KIND,
          responderId: bardId,
          rollMode: "advantage",
        },
      ],
    });
    if (taken.tag !== "needsHoles") throw new Error("Expected the new roll.");
    const rerolled = resolveBattleSubject({
      state: taken.state,
      subject: act.subject,
      fills: [targetFill, savingThrowOutcomeFill(save, [newRollSucceeds])],
    });
    expect(rerolled.tag === "invalid" ? rerolled.message : rerolled.tag).toBe(
      "resolved",
    );
    if (rerolled.tag !== "resolved") return;
    const bard = rerolled.state.combatants.get(bardId);
    expect(bard?.reactionAvailable).toBe(false);
    expect(bard?.conditions).not.toEqual(
      expect.objectContaining({ charmed: true }),
    );
    expect(session.state.combatants.get(bardId)?.reactionAvailable).toBe(true);
  });

  test("a Bard 6 has no Countercharm to offer", () => {
    expect(
      countercharmChoices(failedSaveResult(bardUnderCharmPerson(6))),
    ).toEqual([]);
  });
});

defineSelectedIdentityReplayWitness({
  describeLabel: "Countercharm selected identity replay",
  taskId: "U580-COUNTERCHARM",
  initialProjection: { selectedOffered: false, unselectedNotOffered: false },
  units: [
    {
      unitId: "bard_countercharm",
      procedures: [
        {
          actionName: "doOfferFailedSaveReactionReroll",
          discover: () => ({
            selectedOffered:
              countercharmChoices(failedSaveResult(bardUnderCharmPerson(7)))
                .length === 1,
            unselectedNotOffered:
              countercharmChoices(failedSaveResult(bardUnderCharmPerson(6)))
                .length === 0,
          }),
          projectionAfter: {
            selectedOffered: true,
            unselectedNotOffered: true,
          },
        },
      ],
    },
  ],
});
