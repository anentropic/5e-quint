#!/usr/bin/env bash
# Sync this fork with upstream (dearlordylord/5e-quint). Run by .github/workflows/fork-upstream-sync.yml.
#
# Branches (see FORK.md):
#   master  - an exact mirror of upstream master; only ever fast-forwarded
#   main    - the fork's default branch: upstream plus our fork files and fix branches
#
# Steps:
#   1. Fast-forward the fork's master to upstream master.
#   2. If main already contains upstream master, stop.
#   3. Merge upstream master into a fresh copy of main on SYNC_BRANCH.
#      Clean merge: push SYNC_BRANCH and open (or refresh) one pull request into main.
#      Conflict: open (or refresh) one issue listing the conflicting files; push nothing.
#
# Needs: git, gh, GH_TOKEN with contents, pull requests, issues and workflows write.
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/dearlordylord/5e-quint.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-master}"
MIRROR_BRANCH="${MIRROR_BRANCH:-master}"
BASE_BRANCH="${BASE_BRANCH:-main}"
SYNC_BRANCH="${SYNC_BRANCH:-upstream-sync}"
CONFLICT_TITLE="Upstream sync needs a manual merge"
DRY_RUN="${DRY_RUN:-false}"

log() { printf '%s\n' "$*" >&2; }

# Issues are off by default on a fork; the sync still works without them, it just can't report.
conflict_issue() {
  gh issue list --state open --search "in:title \"$CONFLICT_TITLE\"" --json number \
    --jq '.[0].number // empty' 2>/dev/null || true
}
close_conflict_issue() {
  [ "$DRY_RUN" = true ] && return 0
  local n
  n="$(conflict_issue)"
  if [ -n "$n" ]; then
    gh issue close "$n" --comment "$1" || log "Could not close issue #$n"
  fi
}

if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream "$UPSTREAM_URL"
fi
git fetch --no-tags upstream "$UPSTREAM_BRANCH"
git fetch --no-tags origin "$BASE_BRANCH" "$MIRROR_BRANCH"

upstream_sha="$(git rev-parse "upstream/$UPSTREAM_BRANCH")"
upstream_short="$(git rev-parse --short "$upstream_sha")"
log "Upstream $UPSTREAM_BRANCH is at $upstream_short"

# 1. Mirror. A plain push only succeeds as a fast-forward, so a diverged mirror fails loudly.
if [ "$(git rev-parse "origin/$MIRROR_BRANCH")" != "$upstream_sha" ]; then
  if [ "$DRY_RUN" = true ]; then
    log "[dry run] would fast-forward $MIRROR_BRANCH to $upstream_short"
  else
    if ! git push origin "$upstream_sha:refs/heads/$MIRROR_BRANCH"; then
      log "::error::$MIRROR_BRANCH has commits upstream doesn't, so it can't be fast-forwarded."
      log "Move them to a fix branch, then reset $MIRROR_BRANCH to upstream (see FORK.md)."
      exit 1
    fi
    log "Fast-forwarded $MIRROR_BRANCH to $upstream_short"
  fi
else
  log "$MIRROR_BRANCH is already at upstream"
fi

# 2. Anything new for main?
if git merge-base --is-ancestor "$upstream_sha" "origin/$BASE_BRANCH"; then
  log "$BASE_BRANCH already contains upstream $upstream_short; nothing to do"
  close_conflict_issue "$BASE_BRANCH now contains upstream $upstream_short."
  exit 0
fi

new_commits="$(git rev-list --count "origin/$BASE_BRANCH..$upstream_sha")"
log "$new_commits upstream commits to merge into $BASE_BRANCH"

# 3. Merge on a fresh sync branch.
git checkout -B "$SYNC_BRANCH" "origin/$BASE_BRANCH"
message="Merge upstream $UPSTREAM_BRANCH ($upstream_short) into $BASE_BRANCH"
if git merge --no-ff --no-edit -m "$message" "$upstream_sha"; then
  log "Merged cleanly"
  body="$(cat <<BODY
Weekly sync of [upstream](${UPSTREAM_URL%.git}) \`$UPSTREAM_BRANCH\` at $upstream_sha into \`$BASE_BRANCH\`: $new_commits new upstream commits.

Merge this when CI is green. Opened by \`.github/workflows/fork-upstream-sync.yml\`.
BODY
)"
  if [ "$DRY_RUN" = true ]; then
    log "[dry run] would push $SYNC_BRANCH and open or update its pull request"
    exit 0
  fi
  git push --force origin "$SYNC_BRANCH"
  existing="$(gh pr list --head "$SYNC_BRANCH" --base "$BASE_BRANCH" --state open --json number --jq '.[0].number // empty')"
  if [ -n "$existing" ]; then
    gh pr edit "$existing" --title "$message" --body "$body"
    log "Updated pull request #$existing"
  else
    gh pr create --head "$SYNC_BRANCH" --base "$BASE_BRANCH" --title "$message" --body "$body"
  fi
  if [ "${SYNC_AUTO_MERGE:-false}" = true ]; then
    # Waits for the branch protection's required checks; see FORK.md before turning this on.
    gh pr merge "$SYNC_BRANCH" --auto --merge
  fi
  # A clean merge settles any earlier conflict report.
  close_conflict_issue "Upstream $upstream_short merged cleanly; see the sync pull request."
else
  conflicts="$(git diff --name-only --diff-filter=U)"
  git merge --abort
  log "Merge conflicts in:"
  log "$conflicts"
  body="$(cat <<BODY
Merging upstream \`$UPSTREAM_BRANCH\` at $upstream_sha ($new_commits new commits) into \`$BASE_BRANCH\` conflicts in:

$(printf '%s\n' "$conflicts" | sed 's/^/- `/; s/$/`/')

To resolve:

\`\`\`sh
git fetch origin $BASE_BRANCH && git fetch $UPSTREAM_URL $UPSTREAM_BRANCH
git checkout -B $SYNC_BRANCH origin/$BASE_BRANCH
git merge FETCH_HEAD   # fix the conflicts, then commit
git push --force origin $SYNC_BRANCH
\`\`\`

Then open a pull request from \`$SYNC_BRANCH\` into \`$BASE_BRANCH\`. The next sync closes this issue once \`$BASE_BRANCH\` contains upstream.
BODY
)"
  if [ "$DRY_RUN" = true ]; then
    log "[dry run] would open or update the conflict issue"
    exit 1
  fi
  existing="$(conflict_issue)"
  if [ -n "$existing" ]; then
    gh issue edit "$existing" --body "$body" || log "Could not update issue #$existing"
  else
    gh issue create --title "$CONFLICT_TITLE" --body "$body" ||
      log "Could not open an issue (are Issues enabled on the fork?)"
  fi
  exit 1
fi
