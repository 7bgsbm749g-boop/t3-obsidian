# Floating controls for notes

## Design and implementation plan

Use T3's ThreadDetailsCard, ThreadDetailsPanel, composer and pull request detail
layout as source references. Render native Obsidian elements with the vault's
font, colors, borders and focus rings. Do not embed a remote page or copy React
components and their application stores into the plugin.

1. Shared panel shell: rounded, note-bound cards; header controls; minimize to a
   floating icon; hide/show and minimize/restore commands that accept user hotkeys.
   Keep drafts while hidden or on another tab. Dispose on file replacement/unload.
2. Send: compact project/model toolbar, readable note context preview, optional
   message, destination actions and existing output overrides. Discover models
   from the selected machine. Keep model choices local to this send, preserve
   provider options, and persist the choice in the original dispatch plan.
3. Ask: use the same composer and model controls, with selection context and a
   clear send shortcut. Preserve unsent text during minimize and failures.
4. Workspace: reproduce the screenshot's narrow card, machine/workspace,
   branch, changes, linked pull requests and lineage. Fetch through authenticated
   T3 APIs. Open T3 for controls that still need T3's editor/terminal machinery.
5. Pull requests: show linked PRs, state, branch comparison, checks, review
   activity and changed files using T3's PR API. Keep repository writes in T3
   during this first parity step; no implicit commit, merge or script execution.

Each implementation step is a separate commit. Validate affected checks, build,
lint, and real native desktop rendering in a synthetic vault. Capture the actual
production panels, including minimized state and a narrow viewport, for the draft
PR. Synthetic API data must be labeled; it proves rendering and interactions,
not live service behavior or native iOS behavior.

## Scope of this iteration

This establishes a reusable control surface, rather than claiming complete T3
feature parity. T3 owns editor launch, project-script management, branch mutation,
commit/merge actions, PR authoring/review writes and workflow execution. These
remain explicit links to T3. Future controls can use this shell and add native
implementations with their own authorization and integration checks.
