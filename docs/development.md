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
releases use **t3-obsidian VERSION**; the release title does not set the
Obsidian display name.

Follow the [alpha policy](versioning.md): versions are `0.0.BUILD-alpha` until
the user explicitly leaves alpha. With `--enqueue`, supply `--thread-id ID` and
`--summary "CHANGE"`; choose `--release-type patch`, `minor`, `major`, or `none`
for the private comparison table. The queue always advances the alpha build.

After delivery, publish GitHub assets from the exact immutable release archive,
using its version as the tag, `t3-obsidian VERSION` as the title, and GitHub
prerelease status while the alpha policy is active. Never rebuild the published
assets or include private evidence in release notes.

## References

- [Response delivery](coordinated-response-delivery.md)
- [Project file bridge](codebase-bridge.md)
- [Agent commands and note editing](obsidian-t3-SKILL.md)
- [Bundled dependency licenses](../THIRD_PARTY_NOTICES.md)
