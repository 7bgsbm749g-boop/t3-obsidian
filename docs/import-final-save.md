# Imported response persistence

Completed imports wait up to 15 seconds for the existing response manager to
verify the authoritative T3 final item and complete its checked note write.
The import result distinguishes `saved`, `pending`, and `streaming`. A pending
result includes the current save reason, such as verification, Sync, an
unavailable note, or a changed note. The UI does not report a pending response
as saved. The registered response continues after the bounded wait.

The confirmation dialog closes immediately when **Import response** is pressed.
Import, final saving and optional follow acknowledgements continue after it
closes. Progress and result notices keep pending saves and errors visible. A
second queued activation cannot start another import from the same dialog.

Imported responses can finish through the existing checked native note IO after
their destination tab closes. Core Sync readiness, current-note comparison,
binding identity, native pane fences, and final readback remain required.
Ordinary sent replies retain their existing open-editor completion boundary.

Repeating an import reads its existing response binding from shared settings as
well as legacy note descriptors. It re-registers the same response ID and waits
for the pending save without adding another block or sending a new prompt. An
intact pending container with a missing settings record can recover from the
selected source run and the existing import receipt, including after a note
move. A materialized response and subsequent user edits are preserved.

`response-status` includes `pendingSaveReason` while a local response is waiting.
This is a current observation, not a historical diagnostic log or a writer grant.

Regression coverage in `tests/import-save.test.ts` exercises the packaged mobile
bundle's import, retry, saved-response preservation, and result messages.
`tests/local-response-manager.test.ts` covers bounded waits, verified writes,
Sync waits after a tab closes, failed writes, and deletion. The mobile bundle
tests do not establish native iPhone or Android behavior.

The native lab can be prepared with
`node scripts/build-native-response-lab.mjs NEW_PRIVATE_DIRECTORY --import-save`.
It uses a synthetic exact final item with real native editor and vault IO. It
opens the real confirmation: enable **Follow future runs**, then press **Import
response**. Delayed saving and a synthetic follow acknowledgement must leave the
dialog closed. It also checks the pending Sync message, final persistence after the destination tab
closes, unchanged bytes on repeat import, and visible Reading view content.
It deletes its notes through Obsidian before writing its cleanup receipt.
The optional programmatic hover observation is not a physical hover test.

The October 20 source checks passed 1,181 TypeScript tests and 19 Python tests.
Native evidence is retained outside the vault under
`/home/ubuntu/backups/send-to-t3-code/import-save-fix-20261020T214554Z`.
