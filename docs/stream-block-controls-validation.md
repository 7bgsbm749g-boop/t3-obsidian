# Streaming history controls

Live Preview replaces the native edit action only on generated `t3-progress`
history callouts. The replacement copies the native element's tag, classes and
inline style, and retains the existing header alignment. Active history now offers the explicit **Follow response** button described in
[click-response-scroll.md](click-response-scroll.md), while the edit and close
actions stay hidden. A terminal preview is insufficient: the unique completed
or interrupted fold must exist in the saved document outside tracking markers.
Interrupted history retains its existing `:active` fold identity and expansion
choice. Its exact generated **Interrupted** heading identifies it as terminal,
including history saved by older versions.

After the final save, the history and final answer are ordinary Markdown.
The close button checks the unique terminal fold in the current saved and
displayed editor documents, then deletes only its displayed Markdown range
through Obsidian's normal editor transaction. Native autosave and Sync carry
the change. Native Undo and Redo retain their normal behavior. No response host,
connection, command, lease update, journal mutation or new delivery proof is
required. The final answer, other responses and unsaved ordinary edits remain.

Live Preview's compact tool summaries keep their rendering backing within the
native view so Undo can restore the full Markdown tool output after deletion.
Whole completed groups can be removed as ordinary text; partial compact-shell
edits remain rejected to prevent saving a display reference without its output.
Source mode exposes the complete editable Markdown. Existing completion replay
identities prevent a delayed delivery from overwriting later user edits.

The legacy host history-removal protocol remains readable for existing records
and older clients. The current button does not call that protocol.

Capture listeners stop Live Preview's mouse cursor handler over generated
history without cancelling browser default selection. Ordinary callouts and
Source mode retain their existing behavior. Native links, titles, summaries and
copy controls retain their click events. Verify this in a real client before
release; unit tests cannot establish browser selection or editor adoption.

## Isolated native fixture

Prepare a new evidence directory outside source and all synced vaults:

```sh
node scripts/build-native-response-lab.mjs /absolute/new/evidence --stream-close
```

The command builds an unsynced synthetic vault and outputs its private profile.
It does not launch a window. The current fixture presents saved interrupted and
completed history, an independent active stream, and an unsaved interrupted
preview. Only the saved terminal blocks can offer close. Its `action.json`
mailbox accepts observation and cleanup only:

- `{"kind":"capture","name":"before-close"}` records editor, disk, control
  state and trusted input events in `before-close.json`, with a native screenshot.
- `{"kind":"cleanup"}` deletes all synthetic notes through the vault API and
  records their absence. No T3 threads are created.

Use real native input to click close on the interrupted history and exercise
Undo and Redo. Record snapshots and screenshots outside the vault. Verify saved
and displayed note text after close, including the completed answer, independent
active response, unsaved interrupted preview and ordinary before/after text.
Verify that active output and the unsaved preview have no close action. This fixture has
no live Sync, native mobile or authenticated T3 dispatch coverage. The release
still requires a real QLO2 reload and smoke test with immutable evidence.

Native verification on 2026-10-24 used the isolated Obsidian 1.13.7 editor.
Saved interrupted and completed history showed the same X button; active output
and the unsaved interrupted preview kept it hidden. A trusted native click
removed exactly the interrupted history, autosave wrote the expected bytes,
and native Undo and Redo restored and removed it. Independent responses and
ordinary text remained. All synthetic notes were deleted through the vault API;
no T3 threads were created. Evidence is retained at
`/home/ubuntu/backups/send-to-t3-code/interrupted-close-native-20261024-ca3100d7-verified/verified.json`.
This fixture does not establish native mobile behavior or real Sync propagation.

Native fixture review on 2026-10-06 used Obsidian 1.13.7 and actual Cua input.
Clicking kept history rendered; drag selection and Ctrl+C copied the selected
progress text. Close was hidden during active output and terminal preview,
then appeared after the checked final save. The history header and reference
link worked. Clicking close removed history from both disk and the visible
editor, preserved final prose and surrounding text, and verified the private
removal journal. Evidence is retained at
`/home/ubuntu/backups/send-to-t3-code/stream-close-native-2348-20261006/verified.json`.

## QLO2 release 2.34.9

Immutable source `9cead67` passed the complete 955 JavaScript and 11 Python
suite. The supported release tool installed and freshly synced exact 2.34.9
bytes while preserving each installation's settings during deployment.
A checked native reload loaded fresh instance
`bb284bb2-73bc-46d3-83a4-86e4115f3f04` in QLO2 Obsidian 1.14.4.

A bounded real delivery verified active and completed text clicks, native drag
selection and clipboard text, tool summary expansion and output copy, the
completed close button, and exact history-only deletion. The shortened note
matched the checked host delivery hash and kept its final answer and all
outside bytes. An ordinary callout retained its native edit action. The
synthetic note and tab were removed, and all 19 original leaf IDs and the
original active leaf were preserved. Native deletion displayed a view-close
warning; independent saved-file and workspace checks verified cleanup.
Normal delivery/deletion updated only retained `noteThreads` metadata; no
settings file was manually edited or restored.

Complete receipt:
`/home/ubuntu/backups/send-to-t3-code/releases/2.34.9/smoke-vps-qlo2.json`.
Native evidence:
`/home/ubuntu/backups/send-to-t3-code/stream-close-qlo2-2349-20261006/evidence.json`.
The laptop was offline, so this does not establish a native Windows 2.34.9
reload. There is no native mobile coverage. The separate path thread's
pointer/performance smoke remains incomplete.
