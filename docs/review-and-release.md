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
receipt. GitHub runs release-tool regression checks on PRs and main pushes
without requiring a version bump. Its explicit release-tag workflow runs lint
and build before attesting and publishing. Branch pushes do not publish releases.

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
PRs can retain the current version, including when merged to `main`.

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

The local release queue and workers remain removed. Developing agents finish
with a commit and PR. Branch pushes, main merges and PR completion do not
authorize publication, version assignment or installation. Historical tags,
archives, receipts and private comparison records remain intact.

When the user requests a GitHub release, prepare a new unused numeric
`0.0.BUILD` aligned in `manifest.json`, `package.json`, both package-lock version
fields and the `versions.json` compatibility entry. Validate and commit those
release metadata changes, then tag that exact commit with its version. Push
only that explicitly authorized tag. The
[release workflow](../.github/workflows/release-provenance.yml) installs
dependencies, lints, builds, attests `main.js`, `manifest.json` and `styles.css`,
then publishes a regular release titled `t3-obsidian VERSION`. The tag must
match the source version. Existing tags and assets cannot be overwritten.

To retry a tagged release, dispatch the workflow at that same numeric tag, for
example `gh workflow run release-provenance.yml --ref 0.0.BUILD` with the actual
version substituted. Dispatching at a branch fails the numeric-tag check.
The workflow does not choose or bump versions. Keep the
[alpha version policy](versioning.md).

Personal-vault delivery runs only when the user explicitly asks to try changes.
It is not a prerequisite or side effect of a PR, merge, GitHub release or agent
test. Agents remain responsible for validation in isolated test vaults. Past
verification notes describe historical delivery work and do not reinstate gates.
Obsidian directory submission or review also needs separate instructions.
