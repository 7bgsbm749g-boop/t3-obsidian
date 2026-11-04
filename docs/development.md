# Development

## Repository layout

- `src/app/`: plugin entry point, commands, subscriptions, and lifecycle.
- `src/connection/`: T3 connections, authentication, network, and protocol adapters.
- `src/conversations/`: chat, threads, imports, and inline conversation state.
- `src/interaction/`: agent questions and approvals.
- `src/notes/`: note commands, selection context, images, and Smart Send.
- `src/projects/`: folder links, project files, language views, and worktrees.
- `src/responses/`: streaming, presentation, delivery, recovery, and result views.
- `src/storage/`: private storage and device/synced state.
- `src/ui/`: shared activity effects.
- `tests/`: automated regression checks and fixtures.
- `validation/`: native Obsidian test fixtures.
- `scripts/`: build, validation, and release tools.
- `docs/`: design notes, reference material, and product screenshots.

`manifest.json`, `versions.json`, and `styles.css` stay at the repository root.
The build bundles `src/app/main.ts` into `dist/main.js`; source folders are not
copied into an installed plugin.

## Commands

Install the locked dependencies with `npm ci`. Use `npm run test:plan` to inspect
the affected checks, then `npm test` to build and run them. `npm run build`
creates the standalone plugin bundle. Generated files and local evidence are
excluded from Git.

The installed plugin needs `main.js`, `manifest.json`, and `styles.css` in the
`t-three-code` plugin folder. Its manifest display name is **T3 Code**. GitHub
releases use **t3-obsidian VERSION (Alpha)**; the release title does not set the
Obsidian display name.

Follow the [alpha policy](versioning.md): versions are plain `0.0.BUILD` until
the user explicitly leaves alpha. With `--enqueue`, supply `--thread-id ID` and
`--summary "CHANGE"`; choose `--release-type patch`, `minor`, `major`, or `none`
for the private comparison table. The queue always advances the alpha build.

## Release commits

Each new queued plugin release adds one commit to `main`, titled
`Release VERSION: summary`. It contains the combined task changes and the final
version files. The queue creates that commit before checking and packaging the
release, so the archive provenance and deployment receipt identify the exact
release commit. Supply a useful public description with `--summary`.

Task commits stay on their task branches and in local private queue refs under
`refs/t3-release-queue/`; they are not merge parents on `main`. The queue retains
their ancestry to handle later work based on those tasks, including after a task
branch is removed. Independent changes still merge, and product conflicts still
stop that job. Do not push the private queue refs.

An interrupted integration resumes the same recorded commit. A publication retry
uses the same immutable archive, version, and release commit. A failed candidate
that has not been packaged is removed with an explicit revert; a repaired retry
creates a new candidate with a newer version. Existing history, tags, archives,
and receipts are never rewritten. Old in-flight archives keep their original
provenance and can finish under the previous version-commit scheme.

Documentation and release-tool changes integrate as one `Maintenance: summary`
commit with affected checks and no plugin version or installation. An updated
release engine still restarts the worker before validation or publication.

After delivery, publish GitHub assets from the exact immutable release archive,
using its plain numeric version as the tag and `t3-obsidian VERSION (Alpha)` as
the title. Publish a regular GitHub release for Obsidian distribution; the
project remains in alpha. Mark the new release as latest so the larger legacy
version numbers do not keep the old release selected. Never rebuild the published
assets or include private evidence in release notes.

## References

- [Response delivery](coordinated-response-delivery.md)
- [Project file bridge](codebase-bridge.md)
- [Agent commands and note editing](obsidian-t3-SKILL.md)
- [Bundled dependency licenses](../THIRD_PARTY_NOTICES.md)
