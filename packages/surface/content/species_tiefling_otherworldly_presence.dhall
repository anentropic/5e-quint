-- Otherworldly Presence — SRD 5.2.1 species trait (character-origins.md,
-- Tiefling).
--
-- RAW: "You know the Thaumaturgy cantrip. When you cast it with this trait,
-- the spell uses the same spellcasting ability you use for your Fiendish
-- Legacy trait."

let otherworldlyPresence =
      { id = "species_tiefling_otherworldly_presence"
      , kind = "species_trait"
      , mechanics =
        { family = "species_lineage_ability_spell_access"
        , grants =
          [ { kind = "grant_spell_access"
            , spellId = "thaumaturgy"
            , mode = "known"
            }
          ]
        , spellcastingAbility =
          { kind = "same_as_species_lineage"
          , traitId = "species_tiefling_fiendish_legacy"
          }
        }
      , name = "Otherworldly Presence"
      , provenance =
        { kind = "srd-5.2.1", section = "character-origins.md#Tiefling" }
      , species = "tiefling"
      }

in  otherworldlyPresence
