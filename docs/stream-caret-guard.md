# Caret movement in active responses

Live Preview must keep a collapsed source caret outside a projected response.
Obsidian otherwise exposes the entire native callout as editable Markdown,
including retained tool HTML, even though the projection rejects text edits.

`NativeResponseView` corrects the selection in the same CodeMirror transaction.
Movement from before a response skips to its end; movement from after it skips
to its start. A collapsed text selection inside the response moves to a nearby
boundary. Each caret is checked independently. Native block-edit selections
inside a response are also moved outside it. Browser text selection and
note-wide selections remain available for copying, and ordinary note positions stay editable.
Explicit Source mode keeps its normal selection behavior. Once the response is
saved and no longer projected, this guard no longer applies.

Stream redraws bypass transaction filters to preserve native undo history. They
also check their mapped selection, so a stale caret cannot remain inside newly
rendered response text. The correction changes no note bytes or save projection.

The regression tests in `tests/native-response-projection.test.ts` cover both
directions, multiple carets, block-edit and note-wide selections, a combined ordinary edit and caret
move, Source mode, removal of a projection, and unfiltered stream redraws.

For a real editor check, use a new unsynced lab:

```sh
node scripts/build-native-response-lab.mjs evidence/NEW-TASK/native --interaction
```

The fixture contains a rendered active callout with a retained HTML tool group.
Its `control.json` mailbox accepts `caret-before` and `caret-after` to position
the editor for native arrow-key input. `update` applies another stream update;
`capture` records editor, saved and disk text, visible content, caret position,
rendered callouts and a native screenshot. The trusted key events are recorded
as well. Keep the actual editor focused during the check: an unfocused editor
can hide the original failure. Check both entry directions and a pointer click,
then verify that a stream update retains the callout and the saved anchor.

Send `cleanup` to remove both synthetic notes through the vault API. Check
`cleanup.json` for no remaining notes; this fixture creates no T3 threads.
Evidence stays outside the vault. This desktop check does not establish native
iPhone or Android behavior, or Sync propagation.
