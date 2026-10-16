# Move an active response

In Live Preview, use the grip at the left of an active response heading to drag
that whole reply to another position in the same note. The progress box, tools,
controls, and eventual final answer use the new position. A drop inside a
paragraph goes after that paragraph. Drops also use the existing Markdown block
placement rules for code, lists, and other containers.

The grip is available only while the response is active. Completion, Stop,
errors, conflicts, and a final save disable movement. Finishing during a drag
cancels the unconfirmed drop. Escape, loss of focus, changing notes, or dropping
outside the editor also cancels it. The existing fold and follow controls keep
their own actions. Near an editor edge, dragging scrolls the note.

A move changes the position of the existing saved response anchor; it does not
create another response or provider request. Streaming text remains local to the
editor until the normal final save. Native Undo and Redo move the anchor while
keeping current response content. A completed or detached reply cannot be
restored by an old move history step.

## Verification

`tests/response-move.test.ts` covers Markdown placement, exact inverse edits,
legacy descriptors, independent responses, compact tool output, live streaming
through Undo/Redo, repeated moves, ordinary note edits, and completion/unload
history guards. Existing save-barrier, projection, scroll, and stream-edit tests
continue to apply.

The isolated real-editor fixture can be prepared with:

```sh
npm run validate:native:prepare -- PRIVATE_EVIDENCE_DIRECTORY --response-drag
```

Its `action.json` accepts `stream`, `complete`, `complete-on-drag`, and `snapshot`
with a unique `id`. Only provider output and completion are simulated; use native
pointer input for the move. `complete-on-drag` finishes during a held pointer
movement and records the event order in `state.json`. The fixture has no provider
connection. Keep its evidence outside synced vaults.

Real desktop and official Headless Sync checks do not prove native iPhone or
Android behavior, or the desktop core Sync engine. Record those coverage limits
with each live release check.
