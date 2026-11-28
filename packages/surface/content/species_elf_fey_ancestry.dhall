let charmedSaveAdvantage =
      { kind = "modify_roll_advantage"
      , mode = "advantage"
      , on = [ "saving_throw" ]
      , conditionFilter = [ "charmed" ]
      }

let feyAncestry =
      {  id = "species_elf_fey_ancestry"
      , kind = "species_trait"
      , mechanics =
        { family = "passive"
        , grants = [ charmedSaveAdvantage ]
        }
      , name = "Fey Ancestry"
      , provenance =
        { kind = "srd-5.2.1"
        , section = "character-origins.md#Elf"
        }
      , species = "elf"
      }

in  feyAncestry
