let ProficiencySubject : Type =
      { kind : Text
      , skill : Optional Text
      }

let skill =
      \(skillId : Text) ->
        { kind = "skill"
        , skill = Some skillId
        }

let skillOptions =
      [ skill "insight"
      , skill "perception"
      , skill "survival"
      ] : List ProficiencySubject

let keenSenses =
      {  id = "species_elf_keen_senses"
      , kind = "species_trait"
      , mechanics =
        { family = "passive"
        , grants =
          [ { kind = "grant_proficiency"
            , proficiency =
              { kind = "choice"
              , count = 1
              , options = skillOptions
              }
            }
          ]
        }
      , name = "Keen Senses"
      , provenance =
        { kind = "srd-5.2.1"
        , section = "character-origins.md#Elf"
        }
      , species = "elf"
      }

in  keenSenses
