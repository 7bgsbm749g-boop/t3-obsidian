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
- `tests/native/`: native Obsidian test fixtures. Keep lab-only code here so
  the directory scanner applies its documented test exclusions; ship all runtime
  code from `src/`.
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

## Complete work with a PR

Fetch the PR target, inspect `npm run test:plan`, and run the affected checks in
this development run. The default baseline is the merge-base of `HEAD` with
`origin/main`, with local `main` as a fallback. For another target, pass its
merge-base through `--base COMMIT` to both commands. No installed plugin or
release receipt is needed to select development checks.

The developing agent also owns required integration and native behavior checks,
including the isolated Sync lab for Sync changes. Respect each machine's GUI
rules. Keep synthetic fixtures in a separate test vault, retain results and
cleanup proof outside the checkout, and report any untested platform. If a
required check cannot run, open a draft PR with that limit. Do not defer it to
release work.

Review the final diff, commit all intended changes, push the task branch with
an explicit refspec and tag following disabled, then open a PR against `main`
(or the specified target). Include the problem, resulting behavior and validation.
Do not cherry-pick into a shared integration checkout or install into a real
vault as a completion step. See [Review and release checks](review-and-release.md).

The local release commands, queue, deployment workers and automatic reloads have
been removed. Release work stays on GitHub after PR review. The existing numeric
tag workflow builds and attests distributable bytes on GitHub; this change does
not add release automation. Follow the [alpha policy](versioning.md), and do not
change versions or publish a release for ordinary source work.

## References

- [Response delivery](coordinated-response-delivery.md)
- [Project file bridge](codebase-bridge.md)
- [Agent commands and note editing](obsidian-t3-SKILL.md)
- [Bundled dependency licenses](../THIRD_PARTY_NOTICES.md)
