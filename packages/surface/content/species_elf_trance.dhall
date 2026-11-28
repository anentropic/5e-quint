let trance =
      {  id = "species_elf_trance"
      , kind = "species_trait"
      , mechanics =
        { family = "sleepless_trance"
        , sleep = { needed = False, magicCanImpose = False }
        , longRest =
          { kind = "trancelike_meditation"
          , minimumHours = 4
          , consciousness = "retained"
          }
        }
      , name = "Trance"
      , provenance =
        { kind = "srd-5.2.1"
        , section = "character-origins.md#Elf"
        }
      , species = "elf"
      }

in  trance
