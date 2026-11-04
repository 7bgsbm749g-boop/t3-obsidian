# Caret protection for running and saved responses

Live Preview keeps a collapsed source caret outside running responses and saved
generated history boxes, whether the history is collapsed or expanded.
Obsidian otherwise exposes the entire native callout as editable Markdown,
including retained tool HTML, even though the projection rejects text edits.

`NativeResponseView` uses one selection guard for both. Its protected ranges
combine the existing running-response projection with terminal, untracked
history identified by `streamBlocks`; literal examples remain ordinary text.
The completed final answer stays outside the saved-history range and editable.
The guard corrects the selection in the same CodeMirror transaction.
Movement from before a response skips to its end; movement from after it skips
to its start. A collapsed text selection inside the response moves to a nearby
boundary. Each caret is checked independently. Native block-edit selections
inside a response are also moved outside it. Browser text selection and
note-wide selections remain available for copying, and ordinary note positions stay editable.
Explicit Source mode keeps its normal selection behavior. Active save protection
remains separate from this presentation guard.

Native loading also adopts saved history without tools or a live response record.
The same guard checks the initial caret before the next paint, restored caret
transactions, native editor focus and unchanged view refreshes. A first-line
history includes position zero in its protected range; its safe source position
is on the following line. If the note contains only a saved history box, there
is no source position outside it: native text focus stays outside the editor,
while rendered controls and browser text selection remain available. No padding
or tracking bytes are added to the saved note. Explicit Source mode still
permits direct editing of that note.

Stream redraws bypass transaction filters to preserve native undo history. They
also check their mapped selection, so a stale caret cannot remain inside newly
rendered response text. The correction changes no note bytes or save projection.

The regression tests in `tests/native-response-projection.test.ts` cover both
directions, multiple carets, block-edit and note-wide selections, a combined ordinary edit and caret
move, Source mode, removal of a projection, unfiltered stream redraws, saved
history, first-line opening/restoration, unchanged refreshes and a history-only
note. `tests/native-response-manager.test.ts` checks early loading of history
without tools and exclusion of literal examples.

For a real editor check, use a new unsynced lab:

```sh
node scripts/build-native-response-lab.mjs evidence/NEW-TASK/native --interaction
```

The fixture contains a rendered active callout with a retained HTML tool group.
The `case` command selects `state: "running"` or `"completed"`,
`position: "first"`, `"middle"` or `"only"`, and optional `expanded` and `tools`
booleans. `reopen` restores a caret at zero through native note opening; `caret`
sets an explicit offset (or `"end"`). These commands only prepare synthetic
state; use native input for the actual interaction check.
Its `control.json` mailbox accepts `caret-before` and `caret-after` to position
the editor for native arrow-key input. `update` applies another stream update;
`capture` records editor, saved and disk text, visible content, caret position,
rendered callouts and a native screenshot. Trusted key events record an
immediate observation before native focus restoration as well as a delayed one.
Keep the actual editor focused during the check: an unfocused editor
can hide the original failure. Check both entry directions and a pointer click,
then verify that a stream update retains the callout and the saved anchor.

Send `cleanup` to remove both synthetic notes through the vault API. Check
`cleanup.json` for no remaining notes; this fixture creates no T3 threads.
Evidence stays outside the vault. This desktop check does not establish native
iPhone or Android behavior, or Sync propagation.
