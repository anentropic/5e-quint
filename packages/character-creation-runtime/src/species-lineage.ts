// UNIT-PROFILE-COVERAGE: runtime-owner character-sheet.species-lineage-trait-projection
import { Match, Option, Result } from "effect";
import type {
  SpeciesLineageAbilitySpellAccessMechanics,
  SpeciesLineageChoiceMechanics,
  UnitRecord,
} from "@dnd/surface/surface/types";
import type {
  CharacterBuild,
  CharacterBuildSpeciesLineageSpellcastingAbility,
  UnitCatalog,
} from "./types.ts";
import { computeTotalLevel } from "./character-progression-types.ts";
import { projectCharacterDefinition } from "./character-definition-projection.ts";
import {
  projectCharacterCreationFeature,
  type CharacterCreationSpeciesTraitFacts,
} from "./character-feature-projection.ts";

type SpeciesLineageTraitUnit = CharacterCreationSpeciesTraitFacts & {
  readonly mechanics: SpeciesLineageChoiceMechanics;
};

type SpeciesLineageSource = {
  readonly traitUnitId: UnitRecord["id"];
  readonly mechanics: SpeciesLineageChoiceMechanics;
};

export type CharacterBuildSpeciesLineageOption =
  SpeciesLineageChoiceMechanics["options"][number];

export type CharacterBuildSpeciesLineageTraitProjection = {
  readonly traitUnitId: UnitRecord["id"];
  readonly spellcastingAbility: CharacterBuildSpeciesLineageSpellcastingAbility;
  readonly option: CharacterBuildSpeciesLineageOption;
};

export type CharacterBuildSpeciesLineageTraitProjectionIssue = {
  readonly tag: "speciesLineageTraitProjectionIssue";
  readonly message: string;
};

export function characterBuildSpeciesLineageTraitProjection(input: {
  readonly build: Pick<CharacterBuild, "species" | "speciesChoiceFacts">;
  readonly unitLibrary: UnitCatalog;
}): Result.Result<
  CharacterBuildSpeciesLineageTraitProjection | undefined,
  CharacterBuildSpeciesLineageTraitProjectionIssue
> {
  const selection = input.build.speciesChoiceFacts?.speciesLineage;
  if (selection === undefined) {
    return Result.succeed(undefined);
  }

  const source = speciesLineageSourceForBuild(input);
  if (Result.isFailure(source)) {
    return Result.fail(source.failure);
  }

  const option = source.success.mechanics.options.find(
    (candidate) => candidate.id === selection.lineageId,
  );
  /* v8 ignore start -- @preserve -- The admitted lineage id came from this exact installed option roster. */
  if (option === undefined) {
    return projectionIssue(
      "Selected species lineage id is absent from the selected species trait Surface options.",
    );
  }
  /* v8 ignore stop -- @preserve */
  /* v8 ignore start -- @preserve -- The admitted spellcasting ability came from this exact installed ability roster. */
  if (
    !source.success.mechanics.spellcastingAbilityChoice.abilities.some(
      (ability) => ability === selection.spellcastingAbility,
    )
  ) {
    return projectionIssue(
      "Selected species lineage spellcasting ability is absent from the selected species trait Surface options.",
    );
  }
  /* v8 ignore stop -- @preserve */

  return Result.succeed({
    traitUnitId: source.success.traitUnitId,
    spellcastingAbility: selection.spellcastingAbility,
    option,
  });
}

type SpeciesLineageOptionGrant =
  | CharacterBuildSpeciesLineageOption["mechanics"]["grants"][number]
  | Extract<
      CharacterBuildSpeciesLineageOption,
      { readonly characterLevelGrants: unknown }
    >["characterLevelGrants"][number]["grants"][number];

type SpeciesTraitSpellAccessGrant = Extract<
  SpeciesLineageOptionGrant,
  { readonly kind: "grant_spell_access" }
>;

type SpeciesTraitSpellFreeCastGrant = Extract<
  SpeciesLineageOptionGrant,
  { readonly kind: "grant_spell_free_casts" }
>;

/**
 * A spell a character knows or always has prepared from a species trait, cast
 * with the spellcasting ability chosen for the species lineage.
 */
export type CharacterBuildSpeciesTraitSpellGrant = {
  readonly sourceUnitId: UnitRecord["id"];
  readonly spellId: UnitRecord["id"];
  readonly spellcastingAbility: CharacterBuildSpeciesLineageSpellcastingAbility;
  readonly preparation: "learnedCantrip" | "alwaysPrepared";
  readonly freeCasts?: Pick<
    SpeciesTraitSpellFreeCastGrant,
    "count" | "resetCadence"
  >;
};

/**
 * The spells a build's species traits grant at its character level: the
 * selected lineage option's level 1 spells and the character-level spells it
 * has reached, plus the spells of traits that use the lineage's spellcasting
 * ability (SRD 5.2.1 character-origins.md: Elven Lineage, Fiendish Legacy,
 * Gnomish Lineage and Otherworldly Presence).
 */
export function characterBuildSpeciesTraitSpellGrants(input: {
  readonly build: Pick<
    CharacterBuild,
    "species" | "speciesChoiceFacts" | "progression"
  >;
  readonly unitLibrary: UnitCatalog;
}): Result.Result<
  readonly CharacterBuildSpeciesTraitSpellGrant[],
  CharacterBuildSpeciesLineageTraitProjectionIssue
> {
  const lineage = characterBuildSpeciesLineageTraitProjection(input);
  if (Result.isFailure(lineage)) return Result.fail(lineage.failure);
  if (lineage.success === undefined) return Result.succeed([]);
  const selected = lineage.success;
  const characterLevel = Number(computeTotalLevel(input.build.progression));
  const optionGrants: readonly SpeciesLineageOptionGrant[] = [
    ...selected.option.mechanics.grants,
    ...("characterLevelGrants" in selected.option
      ? selected.option.characterLevelGrants
          .filter((tier) => tier.characterLevel <= characterLevel)
          .flatMap((tier) => tier.grants)
      : []),
  ];
  const lineageGrants = spellGrantsFromGrants({
    sourceUnitId: selected.traitUnitId,
    spellcastingAbility: selected.spellcastingAbility,
    grants: optionGrants,
  });
  const linkedTraits = speciesTraitFactsForBuild(input);
  if (Result.isFailure(linkedTraits)) return Result.fail(linkedTraits.failure);
  const linkedGrants = linkedTraits.success.flatMap((trait) =>
    trait.facts.mechanics.family === "species_lineage_ability_spell_access" &&
    trait.facts.mechanics.spellcastingAbility.traitId === selected.traitUnitId
      ? spellGrantsFromGrants({
          sourceUnitId: trait.traitUnitId,
          spellcastingAbility: selected.spellcastingAbility,
          grants: trait.facts.mechanics.grants,
        })
      : [],
  );
  return Result.succeed([...lineageGrants, ...linkedGrants]);
}

function spellGrantsFromGrants(input: {
  readonly sourceUnitId: UnitRecord["id"];
  readonly spellcastingAbility: CharacterBuildSpeciesLineageSpellcastingAbility;
  readonly grants: readonly (
    | SpeciesLineageOptionGrant
    | SpeciesLineageAbilitySpellAccessMechanics["grants"][number]
  )[];
}): readonly CharacterBuildSpeciesTraitSpellGrant[] {
  return input.grants.flatMap(
    (grant): readonly CharacterBuildSpeciesTraitSpellGrant[] => {
      if (grant.kind !== "grant_spell_access") return [];
      const freeCasts = input.grants.find(
        (candidate): candidate is SpeciesTraitSpellFreeCastGrant =>
          candidate.kind === "grant_spell_free_casts" &&
          candidate.spellId === grant.spellId,
      );
      return [
        {
          sourceUnitId: input.sourceUnitId,
          spellId: grant.spellId,
          spellcastingAbility: input.spellcastingAbility,
          preparation: spellGrantPreparation(grant),
          ...(freeCasts === undefined
            ? {}
            : {
                freeCasts: {
                  count: freeCasts.count,
                  resetCadence: freeCasts.resetCadence,
                },
              }),
        },
      ];
    },
  );
}

function spellGrantPreparation(
  grant: SpeciesTraitSpellAccessGrant,
): CharacterBuildSpeciesTraitSpellGrant["preparation"] {
  return Match.value(grant.mode).pipe(
    Match.when("known", () => "learnedCantrip" as const),
    Match.when("prepared", () => "alwaysPrepared" as const),
    Match.exhaustive,
  );
}

type SpeciesTraitFacts = {
  readonly traitUnitId: UnitRecord["id"];
  readonly facts: CharacterCreationSpeciesTraitFacts;
};

function speciesTraitFactsForBuild(input: {
  readonly build: Pick<CharacterBuild, "species">;
  readonly unitLibrary: UnitCatalog;
}): Result.Result<
  readonly SpeciesTraitFacts[],
  CharacterBuildSpeciesLineageTraitProjectionIssue
> {
  const speciesUnit = input.unitLibrary.getUnit(input.build.species);
  if (Option.isNone(speciesUnit)) {
    return projectionIssue(
      "Selected species lineage requires an installed species Unit.",
    );
  }

  const speciesProjection = projectCharacterDefinition(speciesUnit.value);
  if (
    speciesProjection.tag !== "readable" ||
    speciesProjection.value.kind !== "species"
  ) {
    return projectionIssue(
      "Selected species lineage requires a readable species Unit.",
    );
  }

  return Result.succeed(
    Object.values(speciesProjection.value.facts.traits).flatMap(
      (traitUnitId): readonly SpeciesTraitFacts[] => {
        const traitUnit = input.unitLibrary.getUnit(traitUnitId);
        if (Option.isNone(traitUnit)) return [];
        const projection = projectCharacterCreationFeature(traitUnit.value);
        return projection.tag === "readable" &&
          projection.value.kind === "species_trait"
          ? [{ traitUnitId: traitUnit.value.id, facts: projection.value.facts }]
          : [];
      },
    ),
  );
}

function speciesLineageSourceForBuild(input: {
  readonly build: Pick<CharacterBuild, "species">;
  readonly unitLibrary: UnitCatalog;
}): Result.Result<
  SpeciesLineageSource,
  CharacterBuildSpeciesLineageTraitProjectionIssue
> {
  const traits = speciesTraitFactsForBuild(input);
  if (Result.isFailure(traits)) return Result.fail(traits.failure);
  const sources = traits.success.flatMap(
    ({ traitUnitId, facts }): readonly SpeciesLineageSource[] =>
      isSpeciesLineageTraitUnit(facts)
        ? [{ traitUnitId, mechanics: facts.mechanics }]
        : [],
  );
  /* v8 ignore start -- @preserve -- Support admission retains exactly one installed species lineage trait source for a lineage selection. */
  if (sources.length !== 1) {
    return projectionIssue(
      sources.length === 0
        ? "Selected species lineage requires one species lineage choice trait Unit."
        : "Selected species lineage cannot project from multiple species lineage choice trait Units.",
    );
  }
  /* v8 ignore stop -- @preserve */

  return Result.succeed(sources[0]);
}

function isSpeciesLineageTraitUnit(
  unit: CharacterCreationSpeciesTraitFacts,
): unit is SpeciesLineageTraitUnit {
  return unit.mechanics.family === "species_lineage_choice";
}

function projectionIssue(
  message: string,
): Result.Result<never, CharacterBuildSpeciesLineageTraitProjectionIssue> {
  return Result.fail({ tag: "speciesLineageTraitProjectionIssue", message });
}
