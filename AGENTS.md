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

Documentation and skill-instruction changes use ordinary Git commits, without
plugin builds, version changes, installation, or release jobs. Review the diff
and relevant links. In a configured maintainer checkout, integrate a reviewed
single documentation commit with `python3 scripts/integrate_docs.py COMMIT`.
This runs a normal Git cherry-pick under the repository lock, not the release
queue. Mixed product changes still require the product release process.

## GitHub pushes and publication

`push`, `push to GitHub`, and `push to main` mean upload reviewed commits only.
They do not authorize a version change, release tag, release queue job,
installation, GitHub release, or Obsidian directory submission or review.
The product-delivery default applies to implementation requests, not push
requests. GitHub release publication needs a separate user request or existing
authorization that explicitly covers publication; QLO2 delivery alone does not
provide that authorization.

Before an authorized push, read the shared maintainer instructions below.
Push the intended branch with an explicit refspec and `git -c
push.followTags=false push ...`. Do not use `--tags`, `--follow-tags`, or
`--mirror`, push private queue refs, or create a release tag for a source push.
Do not add release checks or wait for publication work to complete a push.
Normal checks for the requested source change still apply.

GitHub builds run for numeric release tags, not branch pushes or pull requests.
The release workflow must build and attest the exact release assets before
authorized publication. Instruction and workflow maintenance needs no plugin
version, package, installation, or publication. See
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
published history. Do not bump versions for documentation or ordinary source
contributions. Only explicit user direction can end the Alpha stage.

## Evidence and completion

Keep evidence under this repository's ignored `evidence/` directory, outside
synced vaults. Retained release evidence and referenced attachments must be
stored under the configured canonical checkout, not a temporary task checkout.
The queue retains submitted evidence; verify any attachment references as well.

A completed release can remove its task checkout and local branch only when
its submitted commit is still the branch tip, tracked and untracked files are
clean, no active work uses the checkout, and all local files are disposable or
retained elsewhere. Preserve dirty or advanced branches and report the blocker.
Deleting a worktree alone does not delete its branch.
