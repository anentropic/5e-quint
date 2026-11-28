-- Elven Lineage — SRD 5.2.1 species trait (character-origins.md, Elf).
--
-- RAW: choose Drow, High Elf or Wood Elf and gain its level 1 benefit. At
-- character levels 3 and 5 you learn the lineage's higher-level spell, always
-- prepared, castable once per Long Rest without a spell slot and with any
-- spell slot of the appropriate level. Intelligence, Wisdom or Charisma is the
-- spellcasting ability for these spells, chosen with the lineage.

let Grant
    : Type
    = { kind : Text
      , spellId : Optional Text
      , mode : Optional Text
      , sense : Optional Text
      , rangeFeet : Optional Natural
      , feet : Optional Natural
      }

let LevelGrant
    : Type
    = { kind : Text
      , spellId : Text
      , mode : Optional Text
      , count : Optional Natural
      , resetCadence : Optional Text
      }

let CharacterLevelGrants
    : Type
    = { characterLevel : Natural, grants : List LevelGrant }

let CantripReplacement
    : Type
    = { kind : Text, trigger : Text, spellList : Text }

let LineageOption
    : Type
    = { id : Text
      , displayName : Text
      , mechanics : { family : Text, grants : List Grant }
      , characterLevelGrants : List CharacterLevelGrants
      , cantripReplacement : Optional CantripReplacement
      }

let knownCantrip =
      \(spellId : Text) ->
        { kind = "grant_spell_access"
        , spellId = Some spellId
        , mode = Some "known"
        , sense = None Text
        , rangeFeet = None Natural
        , feet = None Natural
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
        }

let drow
    : LineageOption
    = { id = "drow"
      , displayName = "Drow"
      , mechanics =
        { family = "passive"
        , grants =
          [ { kind = "grant_sense"
            , spellId = None Text
            , mode = None Text
            , sense = Some "darkvision"
            , rangeFeet = Some 120
            , feet = None Natural
            }
          , knownCantrip "dancing_lights"
          ]
        }
      , characterLevelGrants =
        [ levelSpell 3 "faerie_fire", levelSpell 5 "darkness" ]
      , cantripReplacement = None CantripReplacement
      }

let highElf
    : LineageOption
    = { id = "high_elf"
      , displayName = "High Elf"
      , mechanics =
        { family = "passive", grants = [ knownCantrip "prestidigitation" ] }
      , characterLevelGrants =
        [ levelSpell 3 "detect_magic", levelSpell 5 "misty_step" ]
      , cantripReplacement = Some
        { kind = "replace_lineage_cantrip"
        , trigger = "long_rest"
        , spellList = "wizard"
        }
      }

let woodElf
    : LineageOption
    = { id = "wood_elf"
      , displayName = "Wood Elf"
      , mechanics =
        { family = "passive"
        , grants =
          [ { kind = "set_speed"
            , spellId = None Text
            , mode = None Text
            , sense = None Text
            , rangeFeet = None Natural
            , feet = Some 35
            }
          , knownCantrip "druidcraft"
          ]
        }
      , characterLevelGrants =
        [ levelSpell 3 "longstrider", levelSpell 5 "pass_without_trace" ]
      , cantripReplacement = None CantripReplacement
      }

let elvenLineage =
      { id = "species_elf_elven_lineage"
      , kind = "species_trait"
      , mechanics =
        { family = "species_lineage_choice"
        , choiceKey = "elven_lineage"
        , timing = "species_selection"
        , spellcastingAbilityChoice =
          { kind = "spellcasting_ability_choice"
          , abilities = [ "int", "wis", "cha" ]
          }
        , options = [ drow, highElf, woodElf ]
        }
      , name = "Elven Lineage"
      , provenance =
        { kind = "srd-5.2.1", section = "character-origins.md#Elf" }
      , species = "elf"
      }

in  elvenLineage
