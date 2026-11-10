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
receipt. GitHub checks PR versions before merge. Its release-tag workflow runs
lint and build before attesting and publishing; feature-branch pushes do not
publish releases.

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
Tooling changes need their affected checks. All PRs need the aligned version
required by the existing GitHub flow before merge, including docs and workflows.

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

The local release process has been removed, including queue submission,
canonical-checkout integration, version assignment, packaging, installation,
Sync delivery, smoke receipts, and automatic client reloads. Developing agents
finish with a commit and PR. There is no local release command to run after it.
Historical tags, archives, receipts and private comparison records remain intact.

Release work stays on GitHub after PR review. The existing
[release workflow](../.github/workflows/release-provenance.yml) checks that every
PR carries a strictly newer aligned `0.0.BUILD`, including docs and workflow
changes. After merge, the main-push job reserves that commit's unused numeric
tag and explicitly dispatches the tag build. GitHub installs dependencies,
lints, builds, attests `main.js`, `manifest.json` and `styles.css`, then publishes
a regular release titled `t3-obsidian VERSION`. Existing tags and assets cannot
be overwritten. This change adds no GitHub release automation.

Feature-branch pushes do not publish. Every push to `main`, including a merged
PR, authorizes this existing automatic GitHub publication. Prepare its newer
aligned version before merge; the workflow does not choose or bump versions.
Developing agents stop at the PR. Vault installation and Obsidian directory
submission or review need separate instructions. Keep the
[alpha version policy](versioning.md).
