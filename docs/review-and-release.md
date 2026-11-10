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
receipt. The release-tag workflow runs the same gates before building. Every
main push dispatches a tag build and publication; pull requests check that the
version is aligned and newer than their base before merge.

An official GitHub installation can lack a local deployment receipt. A maintainer
can retain its verified source identity separately as
`<evidenceRoot>/releases/VERSION/installed-source.json`, with `version`, the exact
`gitCommit`, and `runtimeSha256` for `main.js`, `manifest.json` and `styles.css`.
Verify the published assets and immutable source tag first, retaining that
provenance and any loader-added comment comparison outside the checkout. The
record describes the installed source, not a completed local release or smoke
test. Check selection accepts it only while every installed runtime hash and
the source commit's manifest version match. A local deployment receipt takes
precedence. Unknown or changed installed bytes still block baseline recovery.

## Necessary capabilities and overrides

The plugin uses authenticated network requests and WebSockets for T3 and
Obsidian's APIs for requested note changes and safe final saves. It does not
start a command service on a local port. Normal editor clipboard behavior is
provided by Obsidian; plugin copy buttons and custom link suggestions were
removed. Note, property, folder and job event emissions were removed. Reply
streaming and explicit following remain.
Clerk account requests use Obsidian `requestUrl`. The T3 browser transport keeps
abort, redirect rejection and incremental body reads, which `requestUrl` does
not expose. Import reads discard unrelated fields while streaming and have no
response-size or elapsed-time rejection. Explicit cancellation still applies.
It uses the main window's fetch explicitly. UI listeners and timers
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

A feature-branch push uploads reviewed source without publishing. Every push
to `main`, including a PR merge, publishes a GitHub release after its checks pass.
Supply a strictly newer, unused `0.0.BUILD` in `manifest.json`, `package.json`,
both root version fields in `package-lock.json`, and `versions.json` before
merging or pushing. This rule includes documentation and maintenance changes.
Versions are never assigned silently. Read the shared maintainer instructions
before pushing, use an
explicit branch refspec, and disable implicit tag following:

```sh
git -c push.followTags=false push origin COMMIT:refs/heads/BRANCH
```

Replace `COMMIT` and `BRANCH` with the reviewed commit and intended destination.
Do not push private queue refs or use `--tags`, `--follow-tags`, or `--mirror`.
PR validation rejects a version that does not advance its base. Main validation
also refuses a tag owned by another commit. A failed check stops publication;
fix the source with another new version rather than replacing a reserved tag.
No workflow installs into a vault or submits the directory entry. The local
QLO2 queue remains separate until its replacement is implemented.

## Publish verified assets

### Automatic publication from main

`.github/workflows/release-provenance.yml` reserves a numeric tag at the exact
push commit and explicitly dispatches the same workflow at that tag. GitHub's
repository token does not trigger tag-push workflows by itself, so the explicit
dispatch is required. The tag workflow checks alignment, installs dependencies,
runs lint and builds before attesting all three assets. It uploads them to a
draft, checks their SHA-256 digests, and then publishes a regular release.
An existing draft can resume missing uploads; existing bytes are never replaced.
Rerunning a published version verifies the same bytes without replacing it.

Tag builds use GitHub's bounded concurrency queue (`queue: max`) so a later push
does not cancel an earlier pending release. Older builds do not replace a newer
numeric release as Latest. There are no path filters: documentation-only main
pushes also need a unique version and publish.

### Legacy manual publication

The following helper remains available for previously delivered queue archives.
New main pushes publish automatically and do not need this manual procedure.

1. Complete the normal release queue, changed-behavior smoke checks, fresh Sync,
   and exact real-client verification. Keep all fixtures outside the real vault.
2. Push the reviewed release merge commit, its source history and its exact numeric tag.
   `.github/workflows/release-provenance.yml` builds that tag and uses GitHub's
   official provenance action to attest `main.js`, `manifest.json` and
   `styles.css`. It installs dependencies, runs lint, checks types and builds
   before attesting and publishing. Manual retries must target that same tag.
   These release-asset attestations address the directory's missing-attestation
   recommendation. See the
   [official release workflow guide](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Releasing/Release%20your%20plugin%20with%20GitHub%20Actions.md).
3. After the workflow succeeds, use a current official GitHub CLI and run:

   ```sh
   python3 scripts/publish-github.py VERSION \
     --gh /path/to/verified/gh \
     --notes-file /path/to/release-notes.txt \
     --evidence /path/to/external-project-evidence/publication-VERSION --publish
   ```

   The helper checks delivery receipts, completed smoke evidence, the loaded
   client version, immutable archive hashes and the remote tag. For every asset
   it verifies the exact source ref, source commit and signer workflow using
   [`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify).
   It then creates a regular release titled `t3-obsidian VERSION`. Existing
   tags and assets are never overwritten. Without `--publish`, it only verifies.
4. Obsidian detects new GitHub releases periodically; an existing listing does
   not need a new submission for each update. Request a manual directory check
   or resubmission only when authorized. When verifying a directory review,
   read the complete report, including later build and obfuscation sections,
   and confirm actual acceptance and the public install action. A completed
   review is not proof of acceptance by itself. See the
   [directory FAQ](https://docs.obsidian.md/community-directory/faq).
