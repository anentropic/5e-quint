-- Fiendish Legacy — SRD 5.2.1 species trait (character-origins.md, Tiefling).
--
-- RAW: choose Abyssal, Chthonic or Infernal and gain its level 1 benefit (a
-- Resistance and a cantrip). At character levels 3 and 5 you learn the
-- legacy's higher-level spell, always prepared, castable once per Long Rest
-- without a spell slot and with any spell slot of the appropriate level.
-- Intelligence, Wisdom or Charisma is the spellcasting ability for these
-- spells, chosen with the legacy.

let Grant
    : Type
    = { kind : Text
      , damageType : Optional Text
      , spellId : Optional Text
      , mode : Optional Text
      }

let LevelGrant
    : Type
    = { kind : Text
      , spellId : Text
      , mode : Optional Text
      , count : Optional Natural
      , resetCadence : Optional Text
      }

let levelSpell =
      \(characterLevel : Natural) ->
      \(spellId : Text) ->
        { characterLevel
        , grants =
          [ { kind = "grant_spell_access"
            , spellId
            , mode = Some "prepared"
            , count = None Natural
            , resetCadence = None Text
            }
          , { kind = "grant_spell_free_casts"
            , spellId
            , mode = None Text
            , count = Some 1
            , resetCadence = Some "long_rest"
            }
          ]
          : List LevelGrant
        }

let legacy =
      \(id : Text) ->
      \(displayName : Text) ->
      \(resistance : Text) ->
      \(cantrip : Text) ->
      \(levelThreeSpell : Text) ->
      \(levelFiveSpell : Text) ->
        { id
        , displayName
        , mechanics =
          { family = "passive"
          , grants =
            [ { kind = "grant_resistance"
              , damageType = Some resistance
              , spellId = None Text
              , mode = None Text
              }
            , { kind = "grant_spell_access"
              , damageType = None Text
              , spellId = Some cantrip
              , mode = Some "known"
              }
            ]
            : List Grant
          }
        , characterLevelGrants =
          [ levelSpell 3 levelThreeSpell, levelSpell 5 levelFiveSpell ]
        }

let fiendishLegacy =
      { id = "species_tiefling_fiendish_legacy"
      , kind = "species_trait"
      , mechanics =
        { family = "species_lineage_choice"
        , choiceKey = "fiendish_legacy"
        , timing = "species_selection"
        , spellcastingAbilityChoice =
          { kind = "spellcasting_ability_choice"
          , abilities = [ "int", "wis", "cha" ]
          }
        , options =
          [ legacy
              "abyssal"
              "Abyssal"
              "poison"
              "poison_spray"
              "ray_of_sickness"
              "hold_person"
          , legacy
              "chthonic"
              "Chthonic"
              "necrotic"
              "chill_touch"
              "false_life"
              "ray_of_enfeeblement"
          , legacy
              "infernal"
              "Infernal"
              "fire"
              "fire_bolt"
              "hellish_rebuke"
              "darkness"
          ]
        }
      , name = "Fiendish Legacy"
      , provenance =
        { kind = "srd-5.2.1", section = "character-origins.md#Tiefling" }
      , species = "tiefling"
      }

in  fiendishLegacy
