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
Every Node value import is deferred behind an explicit `Platform.isDesktop`
guard in the adapter that uses it. Do not exempt desktop filenames from the
rule. Editor SDK modules use ES imports from the host's shared runtime. Native
language view adapters load after their SDK version check and before their
synchronous view factories register; language grammars remain lazy.
Keep version guards as direct `if (requireApiVersion(...))` branches so both
older and current directory scanners can verify new API calls. The legacy
`display()` fallback remains virtual for older clients and host integrations;
a deprecation advisory on that compatibility branch is intentional.
`npm test` runs and caches these gates before the affected tests. Cache keys
include installed dependency bytes, runtime, source and configuration. Passing
bounded test batches retain their own logs; failed batches have no success
receipt. CI runs the same gates before building.

## Necessary capabilities and overrides

The plugin uses authenticated network requests and WebSockets for T3, clipboard
access for explicit copy actions, and vault operations for requested note and
response changes. Desktop-only connection and storage adapters also need Node
filesystem and process APIs. These are product capabilities, not unused code.
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

## Publish verified assets

1. Complete the normal release queue, changed-behavior smoke checks, fresh Sync,
   and exact real-client verification. Keep all fixtures outside the real vault.
2. Push the reviewed single-parent release commit and its exact numeric tag.
   `.github/workflows/release-provenance.yml` builds that tag and uses GitHub's
   official provenance action to attest `main.js`, `manifest.json` and
   `styles.css`. Manual retries must target that same tag.
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
4. Resubmit the existing directory entry when requested. Read the complete
   report, including later build and obfuscation sections, and confirm actual
   acceptance and the public install action. A completed review is not proof
   of acceptance by itself.
