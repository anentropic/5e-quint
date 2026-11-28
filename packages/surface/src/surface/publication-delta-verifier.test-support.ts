import {
  type SurfacePublicationDeltaVerificationResult,
  verifySurfacePublicationDeltaWithAuthority,
} from "./publication-delta-verifier-core.ts";

export type SurfacePublicationDeltaFixtureOptions = {
  readonly repoRoot: string;
  readonly publicationDir: string;
  readonly reviewedCertificate: {
    readonly path: string;
    readonly sha256: string;
  };
};

/**
 * Verifies a fixture publication. Fixtures are pinned historical snapshots, so
 * their aggregate is held to its own published schema, not today's contract.
 */
export function verifySurfacePublicationDeltaFixture(
  options: SurfacePublicationDeltaFixtureOptions,
): SurfacePublicationDeltaVerificationResult {
  return verifySurfacePublicationDeltaWithAuthority({
    repoRoot: options.repoRoot,
    publicationDir: options.publicationDir,
    certificateAuthority: options.reviewedCertificate,
    candidateAggregateContract: "ownPublishedSchema",
  });
}
