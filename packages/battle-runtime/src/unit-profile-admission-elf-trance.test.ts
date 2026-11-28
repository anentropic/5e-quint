// UNIT-IDENTITY-EVIDENCE: deterministic-admission-projection SPECIES-ELF-TRAITS species_elf_trance
import { describe, expect, test } from "vitest";

import {
  unitLibrary,
  unitMechanicsVariant,
} from "./unit-profile-admission-catalog.test-support.ts";
import {
  battleCreatureSpaceMovementPermissionSupportForUnit,
  battleD20TestNaturalOneRerollSupportForUnit,
  battleHideActionObscurementPermissionSupportForUnit,
  battleUnitSupportProfilesForUnit,
} from "./unit-feature-support.ts";

const trance = unitLibrary.requireUnit("species_elf_trance");

function malformedTrance() {
  if (trance.kind !== "species_trait") {
    throw new Error("Expected a species-trait record.");
  }
  return unitMechanicsVariant(trance, {
    id: "synthetic_trance_needs_sleep",
    mechanics: {
      ...trance.mechanics,
      sleep: { needed: true, magicCanImpose: false },
    },
  });
}

describe("Elf Trance Battle support", () => {
  test("projects the sleepless support profile from the Surface shape", () => {
    expect(battleUnitSupportProfilesForUnit({ unit: trance })).toMatchObject({
      _tag: "Success",
      success: [{ kind: "sleepless" }],
    });
  });

  test("leaves the other atomic species-trait readers unclaimed", () => {
    expect(battleD20TestNaturalOneRerollSupportForUnit(trance)).toBeNull();
    expect(
      battleCreatureSpaceMovementPermissionSupportForUnit(trance),
    ).toBeNull();
    expect(
      battleHideActionObscurementPermissionSupportForUnit(trance),
    ).toBeNull();
    for (const id of ["species_halfling_luck", "species_halfling_brave"]) {
      const profiles = battleUnitSupportProfilesForUnit({
        unit: unitLibrary.requireUnit(id),
      });
      expect(profiles._tag).toBe("Success");
      expect(
        profiles._tag === "Success" &&
          profiles.success.some(
            (profile) =>
              typeof profile === "object" && profile.kind === "sleepless",
          ),
      ).toBe(false);
    }
  });

  test("rejects a represented shape that still needs sleep", () => {
    const malformed = malformedTrance();
    expect(battleD20TestNaturalOneRerollSupportForUnit(malformed)).toBeNull();
    expect(battleUnitSupportProfilesForUnit({ unit: malformed })).toMatchObject(
      {
        _tag: "Failure",
        failure: {
          message:
            "Unsupported battle sleepless Unit hook: synthetic_trance_needs_sleep.",
        },
      },
    );
  });
});
