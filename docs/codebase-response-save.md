# Project response saves and interrupted controls

The Codebase bridge must compare canonical saved Markdown, rather than the
editor's transient response bodies and compact tool references. Otherwise a
stream update can become a false recovery draft and block refresh. A checked
final response can also leave the bridge's pane baseline behind the saved
project file. Closing its history then incorrectly marks the next save as
uncertain before any transport write takes place.

`native-document-state.ts` supplies the native response view's canonical text,
checked storage baseline, and conservative incoming-file adoption. Registration
is bound to the exact view and file and is removed on disposal. The bridge uses
this state for edit tracking, refresh, peer synchronization, and save-origin
checks. A verified response commit advances the pane baseline even when it did
not pass through a native autosave. Ordinary editors keep their existing native
saved-buffer guards. Conflicting user edits and genuinely unconfirmed writes
retain their existing recovery drafts and save protection. Existing retained
drafts are never cleared merely because the plugin reloads.

Follow eligibility now travels with each response projection. A terminal run
cannot keep following merely because interrupted history preserves its
`:active` fold identity. A terminal state-only update cancels pending follow
frames even when the displayed Markdown is unchanged. Close remains unavailable
until the unique terminal block is saved outside response tracking boundaries.

Regression coverage in `tests/codebase-response-save.test.ts` combines the real
bridge, response view, CodeMirror transactions and checked project IO. It covers
temporary previews, canonical tool retention, final adoption, Close, autosave,
Undo, Redo, reopening, competing project edits, and lost write acknowledgements.
Manager and scroll tests cover terminal updates before final saving.

The native fixture uses a private unsynced vault and an external synthetic
project file, with two independent responses and no T3 dispatch:

```sh
node scripts/build-native-response-lab.mjs evidence/UNIQUE/native --codebase-response-save
```

Its `action.json` mailbox accepts `interrupt`, `commit`, `reopen`, `cleanup`, and
`capture` with a short `name`. Native input must exercise Follow, Close, Undo
and Redo. Snapshots retain canonical text, actual editor text, project bytes,
control visibility, recovery state, and trusted input events. Cleanup deletes
the synthetic vault notes through the vault API and verifies removal of the
synthetic project file. All evidence stays outside synced vaults. This fixture
proves native desktop behavior; it does not establish native mobile coverage.
