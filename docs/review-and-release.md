# Review and release checks

`npm run lint` runs the full recommended official Obsidian rules, including
TypeScript checks, SDK compatibility guards, and manifest validation. Both
errors and warnings fail the command. The upstream rule source, immutable
commit, build script, license and checksum are retained in `scripts/vendor/`.
The manifest description follows the directory word policy without exceptions.
The README can explain how the plugin brings T3 Code into Obsidian.

The same command checks the static entry graph for eager Node imports and
checks CSS for expensive `:has()` selectors, partially supported layout
features, and undocumented priority overrides. Desktop adapters remain lazy;
mobile does not import their filesystem, process, HTTP-server or timer APIs.
The production plugin does not import filesystem, process, or HTTP-server
modules, enumerate vault notes, or access the clipboard. Only desktop hashing
and timers use guarded Node imports. Agent commands and edit proposals use
T3 Connect file RPCs; private receipts and snapshots use IndexedDB. Native
indexed settings require Obsidian 1.13.0; no legacy settings renderer remains.
Historical native test adapters are fixtures, never production imports. The
build refuses test adapters and retired filesystem dependencies in its inputs.
`npm test` runs and caches these gates before the affected tests. Cache keys
include installed dependency bytes, runtime, source and configuration. Passing
bounded test batches retain their own logs; failed batches have no success
receipt. GitHub runs release-tool regression checks on PRs and main pushes.
Development PRs keep aligned numeric metadata without an early bump; the merging
agent allocates a distinct version immediately before an authorized merge.
The nightly schedule tags the selected `main` snapshot at midnight UTC; the
tag build runs lint and build before attesting and publishing. Branch pushes
do not immediately publish releases.

## Necessary capabilities and overrides

The plugin uses authenticated network requests and WebSockets for T3 and
Obsidian's APIs for requested note changes and safe final saves. It does not
start a command service on a local port. Normal editor clipboard behavior is
provided by Obsidian; plugin copy buttons and custom link suggestions were
removed. Note, property, folder and job event emissions were removed. Reply
streaming and explicit following remain.
Clerk account requests use Obsidian `requestUrl`. The T3 browser transport keeps
abort, redirect rejection and incremental body limits, which `requestUrl` does
not expose. It uses the main window's fetch explicitly. UI listeners and timers
belong to their workspace document, including popouts.

The temporary response height guard uses an invisible, noninteractive sibling
inside the native editor scroller. It extends scrollable overflow while native
widgets re-render, then removes only its own element. It does not change the
editable content's inline sizing or text layout. CSS priority overrides are
forbidden. Verify this guard in the real native editor after changes, including
scroll position, selection, fold rendering, resize and cleanup.

The review linter and Obsidian SDK are development dependencies. Their
transitive moderate audit notices concern the development toolchain; none of
those packages are included in the plugin bundle. Linter glob patterns come
from reviewed repository configuration, not notes or network data. Do not force
incompatible toolchain majors or change runtime dependencies to silence a
transitive notice. Reassess exposure when updating the pinned upstream checker.

## Validate before the PR

The developing agent completes the checks for its changes before opening a
ready PR. Fetch the PR target, run `npm run test:plan`, then `npm test` for the
affected checks. Both commands default to the merge-base with `origin/main`
(or local `main`); use `--base COMMIT` for another target. Run `npm run build`
for product changes and keep lint free of errors and warnings.

Complete required native behavior, integration, and Sync checks during the same
agent run. Use isolated synthetic vaults and the existing Sync lab; do not create
test content in QLO2. Observe the machine's GUI rules. Retain source hashes,
behavior results and fixture cleanup proof in the external project evidence
store. A desktop result does not prove native mobile behavior. If required
validation is blocked or incomplete, report it in a draft PR. No later release
worker will perform these checks.

Documentation changes need a diff and link review without local installation.
Tooling changes need their affected checks. Product, documentation and workflow
PRs keep the current numeric source base during development and test builds.
Do not allocate a version merely to open, update or mark a PR ready.

## Commit, push and open a PR

Review the final diff and commit all intended files. Push the task branch with
an explicit refspec and implicit tag following disabled:

```sh
git -c push.followTags=false push origin COMMIT:refs/heads/BRANCH
```

Replace `COMMIT` and `BRANCH` with the reviewed commit and task branch. Read the
shared private instructions before pushing. Open a PR against `main` (or the
specified target) and describe the problem, resulting behavior, checks and
limits. Do not merge without a user request. Do not push historical private
refs or use `--tags`, `--follow-tags`, or `--mirror`.

## GitHub owns releases

The local release queue and workers remain removed. Merged PRs carry version metadata;
merging a PR does not immediately publish or install the plugin. Historical
tags, archives, receipts and private comparison records remain intact.

The [release workflow](../.github/workflows/release-provenance.yml) schedules
publication every night at midnight UTC (`0 0 * * *`). GitHub can delay scheduled
starts. The preparation job validates the version files on the exact scheduled
`main` snapshot, creates its matching immutable numeric tag, then explicitly
dispatches the tag build. This dispatch is necessary because a tag created with
`GITHUB_TOKEN` does not trigger another push workflow. Preparation can write
contents and dispatch Actions; PR jobs have only read access. No private token,
local worker or vault access is needed.

If that exact commit is already published, preparation does nothing. If the
tag exists with an unfinished release, it dispatches the same tag again. If
the number belongs to another commit or is older than the latest release, it
fails without moving tags or publishing old code. The merging agent assigns and
checks a distinct version at merge time. Unmerged PRs are never released.

An explicitly requested early release can still use the aligned numeric
version committed on its source: tag that exact commit and push only that tag.
The
[release workflow](../.github/workflows/release-provenance.yml) installs
dependencies, lints, builds, attests `main.js`, `manifest.json` and `styles.css`,
then publishes a regular release titled `t3-obsidian VERSION`. The tag must
match the source version. Existing tags and assets cannot be overwritten.

To retry a tagged release, dispatch the workflow at that same numeric tag, for
example `gh workflow run release-provenance.yml --ref 0.0.BUILD` with the actual
version substituted. Dispatching at a branch fails the numeric-tag check.
The release workflow does not choose or bump versions; the merging agent does
that through `prepare-merge` immediately before an authorized merge. Keep the
[alpha version policy](versioning.md).

## Agent-managed version allocation at merge time

Only a user request to merge starts this process. The agent handles it without
asking the user to select a number or repair version-only conflicts. Perform
authorized merges one at a time, never with parallel merging agents.

Fetch and integrate the current target before touching version metadata. Resolve
legacy version-only conflicts while preserving compatibility history, dependency
changes and all other meaningful JSON fields. On the clean, committed head of a
ready PR, run:

```sh
python3 scripts/github_release.py prepare-merge --repo OWNER/REPO --pr NUMBER --base origin/main
```

This reads the latest target, other open PRs (including drafts and forks), numeric
release tags and local compatibility history. It selects the next unused number
or retains this PR's still-valid allocation. The helper makes no remote writes.
It stops before changing metadata if a required read fails or the head/target
moves. The low-level `bump` command does not inspect other PRs; do not use it for
merge preparation.

Commit the generated metadata, validate the affected changes, push the exact
branch head and finish required checks and reviews. Fetch again immediately
before merging. If the target moved, integrate it and repeat preparation and
affected validation. Check the latest version inventory with:

```sh
python3 scripts/github_release.py validate-merge --repo OWNER/REPO --pr NUMBER --base origin/main
```

If another PR claimed the number, or it has been published or overtaken by the
target, the agent prepares and validates again. Merge only the checked SHA using
an expected-head guard, such as `gh pr merge NUMBER --merge --match-head-commit SHA`.
Do not bypass repository rules or reviews. An allocation is an inventory check,
not a remote lock: the merging agent owns serialization and fresh rechecks.
Development CI success alone is not authorization or proof that a PR is ready
to merge against a changed target.

Personal-vault delivery runs only when the user explicitly asks to try changes.
It is not a prerequisite or side effect of a PR, merge, GitHub release or agent
test. Agents remain responsible for validation in isolated test vaults. Past
verification notes describe historical delivery work and do not reinstate gates.
Obsidian directory submission or review also needs separate instructions.
