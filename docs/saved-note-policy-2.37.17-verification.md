# Automatic saved-note selection: 2.37.17

Native editor text conflicts now select a fresh, rechecked saved file and discard
the competing local text. The dialog, manual saved/local choice command, local
conflict copies and choice receipts are removed. Existing copies and receipts
are deleted through Obsidian's vault-scoped storage API on load.

Automatic selection drains native writes already in progress, checks pane and
file identity after asynchronous reads, repeats a changed revision read, and
invalidates a held final-write snapshot if selection changes its pane. Missing
or resurrected response anchors still require completion evidence. Compatible
ordinary edits, native typing, undo, canonical tool output and independent
response registrations retain their existing behavior.

Reviewed source commit: `cc20954`. The build and all 1,389 TypeScript plus 14
Python tests passed before release. The supported release command repeated the
build and complete suite, created immutable 2.37.17, installed both vaults,
preserved their settings bytes, and verified a fresh fully synced scan.

The real QLO2 Obsidian 1.14.4 client loaded 2.37.17 through the supported native
reload command. Final smoke instance: `1e2956a9-07f8-4318-ba1d-f77ea215b758`.

A synthetic note in the installed client triggered the actual native text
conflict path. The editor adopted `Saved file wins`, discarded the local text,
kept the full canonical tool output and its compact display, and opened no
dialog. The manual command was absent. The one pre-existing local conflict
copy was removed on load; no new copy or choice receipt was created. A trusted
native `x` key reached the saved file. Native undo restored the exact prior
saved hash. Screenshots show the saved text in the actual editor.

A bounded delivery of an existing completed T3 reply also used the normal
attachment and checked completion path. Binding
`124f0dd9-2544-5797-afd3-e7670a3a7c31` reached verified completion with two
acknowledgements and matching saved SHA-256
`836663144b48c803307f4ea2205004c6574c3103ff57e6d00db1f61271df3429`.
No new T3 turn was dispatched for this smoke.

Both owned test notes were removed. All 37 original Markdown panes, their note
paths, the original active leaf and original saved note hashes were retained.
QLO2 settings remained byte-identical to the release backup. Development
settings preservation was checked by the supported installer.

Immutable smoke receipt:
`/home/ubuntu/backups/send-to-t3-code/releases/2.37.17/smoke-vps-qlo2-saved-note.json`.
Its evidence bundle records exact runtime hashes, native checks, screenshots,
save and undo hashes, delivery acknowledgements and cleanup. Working evidence:
`/home/ubuntu/backups/send-to-t3-code/investigations/saved-note-policy-20261012T213930Z`.

The supported laptop reload helper also completed and reported loaded version
2.37.17 in instance `be24fedd-5e3d-4b5a-a32e-8df29e27288a`. Its separate
`laptop-reload-final.json` records loaded-version verification, not a GUI smoke.

This establishes fresh Headless Sync publication and visible adoption in the
VPS desktop client. It does not establish desktop core Sync-engine behavior,
native Windows GUI behavior, or native iPhone/Android coverage.
