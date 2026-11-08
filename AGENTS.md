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

## Development and validation

Use Node.js 22, npm, and Python 3. Preserve the existing lockfile and resolved
versions. `npm ci` installs dependencies. `npm run build` checks TypeScript and
creates `dist/main.js`; it does not install the plugin.

Use `npm run test:plan` and `npm test` for affected checks. An explicit
`--base COMMIT` selects a development baseline. Do not run the full suite by
default. Add meaningful regression coverage for behavior changes.

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

Documentation and skill-instruction changes use ordinary Git commits without
local installation or release jobs. A main push still requires the version bump
and automatic GitHub release described below. Review the diff
and relevant links. In a configured maintainer checkout, integrate a reviewed
single documentation commit with `python3 scripts/integrate_docs.py COMMIT`.
This runs a normal Git cherry-pick under the repository lock, not the release
queue. Mixed product changes still require the product release process.

The MCP editing skill and server are bundled product assets. Changes to
`skills/obsidian-t3/SKILL.md`, `agent/mcp_server.py`, or its transport that change
the installed agent integration use the product checks and release path. Keep
that skill self-contained: a library installation has no repository checkout.

## GitHub pushes and publication

Every push to `main`, including a merged pull request, authorizes automatic
GitHub release publication. It must include a strictly newer, unused numeric
`0.0.BUILD` version aligned across all version files. This includes documentation
and workflow-only pushes to `main`. Feature-branch pushes do not publish.
The workflow does not assign versions or install into a vault. QLO2 delivery
and Obsidian directory submission or review remain separate operations.

Before an authorized push, read the shared maintainer instructions below.
Push the intended branch with an explicit refspec and `git -c
push.followTags=false push ...`. Do not use `--tags`, `--follow-tags`, or
`--mirror`, push private queue refs, or create a release tag for a source push.
Normal checks for the requested source change still apply. Confirm that the
automatic tag build and publication succeed before reporting a main push complete.

The main-push workflow validates version alignment, reserves the exact source
commit's numeric tag, and explicitly dispatches its tag workflow. The tag workflow
runs lint, builds and attests the exact release assets, then publishes a regular
Alpha release. Pull requests check the version before merge. Do not overwrite
existing tags or release assets. Source-only maintenance remains available on
feature branches; merging or pushing it to main requires a new version. See
[Review and release checks](docs/review-and-release.md).

## Maintainer configuration and releases

Machine-specific paths and deployment instructions are private. Before an
authorized maintainer operation, read them with
`python3 scripts/maintainer_config.py --instructions`. Configuration is stored
under `t3-obsidian/` in the Git common directory, shared by linked worktrees;
`T3_OBSIDIAN_MAINTAINER_CONFIG` can select another local JSON file. Do not commit
personal installation paths, vault locations, or local settings.

Product delivery uses the existing serialized release queue. Commit reviewed
source before submission. Do not edit the integration checkout by hand or
replace immutable archives and receipts. The queue owns final integration,
version assignment, validation, packaging, installation, and client checks.
Publication is incomplete until the required behavior and cleanup proof pass.
Follow the private maintainer instructions for the configured delivery route.

The project remains Alpha. New versions use numeric `0.0.BUILD`; Alpha is a
separate release-title label. Keep all version files aligned and preserve
published history. Feature-branch source contributions need no version bump;
every main push requires one. Only explicit user direction can end the Alpha stage.

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
Legacy in-project symlinks preserve existing references only. The queue retains
submitted evidence; verify that referenced attachments are retained as well.

A completed release can remove its task checkout and local branch only when
its submitted commit is still the branch tip, tracked and untracked files are
clean, no active work uses the checkout, and all local files are disposable or
retained elsewhere. Preserve dirty or advanced branches and report the blocker.
Deleting a worktree alone does not delete its branch.
