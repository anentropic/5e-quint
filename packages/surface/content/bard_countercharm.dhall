-- Countercharm — SRD 5.2.1 Bard level 7.
--
-- RAW (Classes / Bard / Level 7: Countercharm):
--   If you or a creature within 30 feet of you fails a saving throw against
--   an effect that applies the Charmed or Frightened condition, you can take
--   a Reaction to cause the save to be rerolled, and the new roll has
--   Advantage.

let countercharm =
      { kind = "class_feature"
      , id = "bard_countercharm"
      , name = "Countercharm"
      , className = "bard"
      , acquiredAtLevel = 7
      , provenance = { kind = "srd-5.2.1", section = "classes.md:914-916" }
      , mechanics =
          { family = "failed_saving_throw_reroll_reaction"
          , activationCost = { kind = "reaction" }
          , trigger =
              { kind = "creature_fails_saving_throw"
              , creatures = "self_or_creature_within_range"
              , rangeFeet = 30
              , againstEffectApplyingAnyOf = [ "charmed", "frightened" ]
              }
          , reroll = { mustUseNewRoll = True, rollMode = "advantage" }
          }
      }

in  countercharm
