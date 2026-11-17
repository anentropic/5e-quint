# anentropic/5e-quint

A fork of [dearlordylord/5e-quint](https://github.com/dearlordylord/5e-quint) for
[dnd-battle-map](https://github.com/anentropic/dnd-battle-map), which depends on it.
It carries fixes we need before upstream has them, and we offer each fix upstream.
The original licence terms apply: see `LICENSE` and `NOTICE`. Files changed in this
fork are listed by `git diff master...main`.

## Branches

- **`master`**: an exact mirror of upstream `master`. Never commit to it. The sync only
  fast-forwards it.
- **`main`**: the default branch. Upstream `master`, plus the fork's own files (this one,
  `.github/fork/`, `.github/workflows/fork-upstream-sync.yml`), plus merged fix branches.
- **`fix/<name>`**: one fix each, branched from `master`, never from `main`, so each can be
  opened upstream as a pull request unchanged. Merge it into `main` with a pull request.
  Once upstream merges it, the next sync brings it back through `master`, and the branch
  can be deleted.
- **`upstream-sync`**: made by the sync; don't commit to it by hand except to resolve a
  conflict.

## The weekly sync

`.github/workflows/fork-upstream-sync.yml` runs `.github/fork/upstream-sync.sh` every
Monday at 06:17 UTC, and on demand from the Actions tab ("Run workflow"). It:

1. fast-forwards `master` to upstream `master` (and fails if `master` has diverged);
2. stops if `main` already contains upstream;
3. merges upstream into a fresh copy of `main` on `upstream-sync`:
   - **clean**: pushes it and opens (or refreshes) one pull request into `main`, whose CI
     is upstream's own Quality workflow. Merge it when green;
   - **conflict**: pushes nothing, opens (or refreshes) one issue titled "Upstream sync
     needs a manual merge" with the conflicting files and the commands to resolve them,
     and the run fails so GitHub emails you. The issue closes itself once `main`
     contains upstream.

## One-time setup

1. **Default branch**: Settings, General, Default branch: `main`. Scheduled workflows run
   only from the default branch.
2. **Actions**: enable workflows on the fork (Actions tab).
3. **Turn off upstream's connectivity check**: Actions, "Public MCP connectivity", "...",
   Disable workflow. It runs every 15 minutes against upstream's hosted MCP server and has
   no use here. Upstream's other workflows only run on pushes, pull requests or by hand.
4. **Issues**: Settings, General, Features, Issues, so a conflict can be reported.
5. **`SYNC_TOKEN` secret** (Settings, Secrets and variables, Actions): a fine-grained
   personal access token for `anentropic/5e-quint` only, with Contents, Pull requests,
   Issues and Workflows set to read and write. The built-in `GITHUB_TOKEN` can't push a
   merge that changes upstream's workflow files, and pull requests it opens don't run CI.
6. **Optional, auto-merge**: protect `main` with upstream's Quality check required, turn on
   "Allow auto-merge" (Settings, General), and set the Actions variable
   `SYNC_AUTO_MERGE` to `true`. Each clean sync then merges itself once Quality passes.
   Without required checks, auto-merge would merge straight away, so leave it off until
   the protection is in place.
