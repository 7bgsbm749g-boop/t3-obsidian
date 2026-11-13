# Contributor and agent guidance

## Scope and source

This repository contains the T3 Code plugin for Obsidian. Its plugin ID is
`t-three-code`. Preserve existing settings, storage namespaces, and compatibility
identities. Use the current source layout: `src/app/`, `src/connection/`,
`src/conversations/`, `src/projects/`, `src/responses/`, `tests/`, and `scripts/`.
Never edit an installed plugin bundle as source.

Inspect the working tree before editing and preserve unrelated changes.
Investigation and review are read-only unless implementation is requested.
Commit all intended tracked changes, including instruction and skill files,
before reporting them complete. Report failed checks and unfinished work.

## Start from current source

Before editing, fetch the PR target with `git fetch --no-tags origin main` and
check `git status`, the branch, and its relation to `origin/main`. A new clean
worktree with no task commits must fast-forward to the fetched target. An
existing task branch must merge the target and resolve conflicts while keeping
its intended changes. Do not reset active branches or discard local work.

Keep T3 Auto-pull enabled for this project. Before new worktrees are made, the
main project checkout must be clean and current: fetch, then
`git merge --ff-only origin/main` while it is on `main`. Auto-pull does not
update existing task worktrees. Fetch and check again before final validation
and PR creation; if the target changed, integrate it and repeat affected checks.

## Development and validation

Use Node.js 22, npm, and Python 3. Preserve the existing lockfile and resolved
versions. `npm ci` installs dependencies. `npm run build` checks TypeScript and
creates `dist/main.js`; it does not install the plugin.

The developing agent owns all validation before completion. Use
`npm run test:plan` and `npm test` for affected checks, and `npm run build` for
product changes. The default baseline is the merge-base with `origin/main`
(or local `main`); `--base COMMIT` selects another PR target. Fetch the target
before final validation. Do not run the full suite by default. Add meaningful
regression coverage for behavior changes. Preserve and run existing affected checks.

Complete all required behavior, integration, native-client and Sync checks in
the developing agent run. Do not defer testing to a queue, release worker, or
later publication step. Use the isolated Sync lab when Sync behavior changes.
Run GUI checks only when the user requests them on this machine; if a required
check is unavailable, report it and keep the PR in draft. Retain source identity,
results and fixture cleanup proof in the external evidence directory.

`npm run lint` must pass with zero errors or warnings. Preserve platform
boundaries: guard deferred Node runtime imports with `Platform.isDesktop`,
use `import()` type queries for Node types, and do not introduce static Node
imports or require-style imports. CSS priority overrides are forbidden. Changes
to the response-height spacer require native viewport and rendered-pixel proof.

Agent note changes use the checked T3 Connect command-file protocol and native
Obsidian editing APIs. Preserve active reply boundaries, compatible user edits,
and checked final saves on completion and Stop. Do not restore plugin runtime
filesystem/process imports, local HTTP command servers, vault enumeration,
custom clipboard access, event emissions, or the legacy settings renderer.
Historical native adapters belong only in test fixtures. See
[Checked note edits](docs/checked-note-edits.md).

Keep credentials and real vault content out of committed fixtures and reports.
Use synthetic fixtures in a separate test vault. Preserve installed `data.json`.
Desktop checks do not prove native mobile behavior. Clean up temporary test
notes, threads, apps, and helpers after retaining evidence.

## Documentation and skills

Documentation and skill-instruction changes use the same commit-and-PR flow,
without local installation. Review the diff and relevant links. PRs and merges
to `main` do not require a version bump, including product, documentation and
workflow changes. Keep existing version fields until preparing a GitHub release.

The MCP editing skill and server are bundled product assets. Changes to
`skills/obsidian-t3/SKILL.md`, `agent/mcp_server.py`, or its transport that change
the installed agent integration need the affected product checks before the PR.
Keep that skill self-contained: a library installation has no repository checkout.

## Completed work and GitHub releases

Finish completed work by reviewing the diff, committing all intended changes,
pushing the task branch, and opening a PR against `main` (or the user's specified
target). Include the problem, changed behavior, validation results, and any
remaining limits in the PR. Use a draft PR if required validation is incomplete.
Do not merge the PR unless the user requests it.

`push`, `push to GitHub`, and `push to main` authorize source uploads only.
Feature-branch and main pushes do not publish, assign versions or create tags.
GitHub releases are separate, explicitly requested work. Only a GitHub release
needs a new unused numeric `0.0.BUILD`, aligned across all version files and its
immutable tag. A deliberate numeric tag push starts the release build;
workflow dispatch at that tag can retry it. Vault installation and Obsidian
directory submission or review remain separate. Developing agents finish at
the PR unless directed otherwise.

Before a push, read any shared private instructions with
`python3 scripts/maintainer_config.py --instructions`. Use an explicit refspec
and `git -c push.followTags=false push ...`. Do not use `--tags`, `--follow-tags`,
or `--mirror`, upload historical private refs, or create release tags for source
work. See [Review and release checks](docs/review-and-release.md).

The project remains Alpha. Published versions use numeric `0.0.BUILD`; Alpha is
the development stage, not a release-title label. Titles use
`t3-obsidian VERSION`. Keep all version files aligned and preserve published
history. Ordinary PRs and main merges retain the existing version; assign a new
one only when preparing a GitHub release. Only explicit user direction can end Alpha.

Personal-vault delivery is separate from development validation, PRs, merges
and GitHub releases. Deliver only when the user explicitly asks to try a build.
It is for the user's personal testing, never a substitute for agent validation
in isolated test vaults. Historical verification notes do not add delivery gates.

## Issue diagnostics

When asked about a plugin issue, read the existing automatic per-device JSONL
logs before requesting more diagnostics. The checked `client-status` result's
`diagnosticLog` gives the exact T3 machine/workspace/directory. Logs live below
`<No project workspace>/.t3-obsidian/diagnostics/<vault UUID>/<device UUID>/`.
They are ordinary agent-readable files, retained until the user deletes them;
do not ask the user to export/copy logs. Read only relevant time ranges with
bounded memory. See [Automatic diagnostic log files](docs/stream-memory-diagnostics.md).

## Evidence and completion

Store evidence outside all project checkouts and worktrees, in the external
project evidence root set by fleet guidance and local maintainer configuration.
Use separate task subdirectories and link directly to the retained files.
Legacy in-project symlinks preserve existing references only. The developing
agent retains evidence and referenced attachments before opening the PR. Keep
credentials, real vault content, and private thread records out of GitHub.

A task checkout and local branch can be removed only through the owning app,
after the work is merged, tracked and untracked files are clean, no active work
uses the checkout, and all local files are disposable or retained elsewhere. Preserve dirty or advanced branches and report the
blocker.
Deleting a worktree alone does not delete its branch.
