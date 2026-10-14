# Automatic Send/Ask destinations — QLO2 2.40.0

Ordinary Send and Ask actions use the same default as the existing selector:
the scoped running response for an Ask, the note's remembered thread, or a new
thread when there is no default. Control at palette or menu activation opens
the selector. The explicit choose-destination command and mobile menu entries
provide access without Control. A configured Send shortcut that requires
Control remains an automatic send.

The source change is `9eed923`; the release version commit is `82e784d`.
The clean release build passed 1,482 TypeScript tests and 17 Python tests.
Checks cover destination validation and timeout, duplicate activation, source
selection, thread reuse and steering, modifier capture, window isolation,
shortcut handling, and selector cancellation. Existing selector tests now
request the selector explicitly.

The supported release command installed development and QLO2 runtime artifacts,
preserved each installation's settings, and required a fresh `Fully synced`
scan. Unrelated checkout changes were stored during packaging and restored
byte-for-byte afterward.

The real VPS QLO2 client ran Obsidian 1.14.4. Its native
**Reload app without saving** command changed the observed client instance and
loaded version from 2.39.0 to 2.40.0. Screenshots and T3 timeline evidence prove:

- Control+Enter in the palette opened the selector. Cancellation did not change
  the note or start a thread. Normal Enter created a thread without a selector.
- The editor offered Ask only for selected text. Control-click opened the
  selector; ordinary Ask sent the captured selection to the previous thread.
- Control-click on the Files sidebar action opened the selector. Ordinary
  activation sent the whole note to the previous thread without a selector.
- All three real deliveries completed in the same T3 thread, with their replies
  visible in the editor. The temporary note and extra test tabs were removed.
  The original active note, its content, sidebar presentation, global
  preferences, and unrelated source edits were preserved.

The immutable complete receipt is
`/home/ubuntu/backups/send-to-t3-code/releases/2.40.0/smoke-vps-qlo2.json`.
Its evidence manifest links screenshots, runtime and client identities, the
completed T3 timeline, clean release checks, and preservation checks under
`/home/ubuntu/backups/send-to-t3-code/default-send-20261014T133615Z`.

Native iPhone and Android UI were not tested. Mobile source behavior has
automated coverage; this does not establish native mobile UI results.
