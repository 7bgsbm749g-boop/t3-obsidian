# Streaming history controls

Live Preview replaces the native edit action only on generated `t3-progress`
history callouts. The replacement copies the native element's tag, classes and
inline style, and retains the existing header alignment. Active history has no
edit or close action. A terminal preview is insufficient: the unique completed
fold must exist in the saved document outside tracking markers.

The close command checks the note path, fold key and exact history checksum.
The host verifies its original committed result and every generated range,
including staged note changes. It journals a removal intent before a checked
save and publishes a new immutable delivery proof after readback. The original
response and commit remain in the private journal. The final answer and other
responses remain in the note. Recovery uses the shortened proof after a known
completed rename; unrelated note edits remain permitted.

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
It does not launch a window. Observe project GUI coordination before launching.
Its `control.json` mailbox accepts lifecycle setup and observation only:

- `{"kind":"snapshot"}` records current state in `stream-close.json`.
- `{"kind":"complete-preview"}` presents completed history while the saved
  response anchor remains empty. The close action must remain hidden.
- `{"kind":"finish"}` runs the production coordinated writer to save and adopt
  the final response. The close action must then appear.

Use real native input to click history text, drag-select and copy it, toggle
history and tool summaries, follow the reference link, and click close. Record
snapshots and screenshots outside the vault. Verify saved and displayed note
text after close, including the final answer and ordinary before/after text.
Check that an ordinary callout keeps its native edit action. This fixture has
no live Sync, native mobile or authenticated T3 dispatch coverage. The release
still requires a real QLO2 reload and smoke test with immutable evidence.

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
