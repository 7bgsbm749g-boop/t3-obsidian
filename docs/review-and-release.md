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
receipt. The release-tag workflow runs the same gates before building; branch
pushes and pull requests do not run a GitHub build workflow.

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

## Push source commits

A request to push means upload reviewed commits to the intended GitHub branch.
It does not authorize a version bump, release tag, release queue job, vault
installation, GitHub release, or directory submission or review. Keep normal
development checks for the requested changes, but do not run release checks
just to push. Read the shared maintainer instructions before pushing, use an
explicit branch refspec, and disable implicit tag following:

```sh
git -c push.followTags=false push origin COMMIT:refs/heads/BRANCH
```

Replace `COMMIT` and `BRANCH` with the reviewed commit and intended destination.
Do not push private queue refs or use `--tags`, `--follow-tags`, or `--mirror`.
Source pushes and pull requests do not trigger hosted build checks. Workflow
maintenance uses the queue's source-only maintenance route, without a plugin
version or installation; documentation-only commits use `scripts/integrate_docs.py`.

## Publish verified assets

Use this procedure only when the user requested GitHub release publication or
already authorized it explicitly. A push request or QLO2 installation does not
authorize these steps.

1. Complete the normal release queue, changed-behavior smoke checks, fresh Sync,
   and exact real-client verification. Keep all fixtures outside the real vault.
2. Push the reviewed single-parent release commit and its exact numeric tag.
   `.github/workflows/release-provenance.yml` builds that tag and uses GitHub's
   official provenance action to attest `main.js`, `manifest.json` and
   `styles.css`. It installs dependencies, runs lint, checks types and builds
   before attesting. Manual retries must target that same tag. Removing branch
   and pull-request builds does not remove these release-asset attestations,
   which address the directory's missing-attestation recommendation. See the
   [official release workflow guide](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Releasing/Release%20your%20plugin%20with%20GitHub%20Actions.md).
3. After the workflow succeeds, use a current official GitHub CLI and run:

   ```sh
   python3 scripts/publish-github.py VERSION \
     --gh /path/to/verified/gh \
     --notes-file /path/to/release-notes.txt \
     --evidence evidence/publication-VERSION --publish
   ```

   The helper checks delivery receipts, completed smoke evidence, the loaded
   client version, immutable archive hashes and the remote tag. For every asset
   it verifies the exact source ref, source commit and signer workflow using
   [`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify).
   It then creates a regular release with the Alpha display label. Existing
   tags and assets are never overwritten. Without `--publish`, it only verifies.
4. Obsidian detects new GitHub releases periodically; an existing listing does
   not need a new submission for each update. Request a manual directory check
   or resubmission only when authorized. When verifying a directory review,
   read the complete report, including later build and obfuscation sections,
   and confirm actual acceptance and the public install action. A completed
   review is not proof of acceptance by itself. See the
   [directory FAQ](https://docs.obsidian.md/community-directory/faq).
