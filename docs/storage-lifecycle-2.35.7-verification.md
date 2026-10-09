# Storage lifecycle release 2.35.7

The immutable QLO2 release uses source commit
`4e17173d1e656e859df273a69ab6c5d18b038a86`. Build, 1,111 TypeScript tests and
11 Python tests passed. Both installations preserved `data.json` during
deployment. The real QLO2 client loaded the released bytes and passed the smoke
test on 2026-10-09.

## Real QLO2 checks

- A bounded real response continued across an authenticated app reload. The
  response was visibly Working one second after the new client reported its
  loaded version. Its saved reply and materialization proof matched exactly.
- Ordinary text and the earlier reply remained intact. The completed journal
  had no conflict copies or streaming checkpoint. Its temporary original and
  staged note files were removed after the matching device acknowledgement.
- The operational store moved outside QLO2. The old inline, event and command
  directories were absent. A fresh official Headless Sync scan reported
  `Fully synced`; the continuous service was restored.
- All 270 existing response journals passed current-head authentication and
  object checksum checks. Their original/request identities matched the
  pre-migration evidence. All 177 unresolved conflict records matched exactly.
- Cleanup had reclaimed 10.58 GiB of allocated storage at the recorded smoke
  measurement. About 14.34 GiB was free. The remaining obsolete snapshots were
  still being removed by bounded maintenance; the receipt does not claim that
  the backlog had already drained.
- The user's open note had moved to a new folder. Its private editor backup
  matched the current saved file before reopening it. The saved note was
  unchanged after testing. The owned temporary test note was removed.

## Independent Sync fixture

Two independent real desktop editors used the synthetic T3 Sync Test Lab and
official Headless Sync. Completion and full device-journal retirement succeeded
while sender Sync was stopped. After reconnection, the other open editor adopted
the exact saved text without reload or conflict. The small replay receipt
remained. An initial receiver-open failure was retained in the evidence and
resolved before response registration.

This does not verify the desktop core Sync engine or native iPhone/Android.
Every participating client must load 2.35.7 before using the external route.

## Retained evidence

The immutable smoke receipt is
`/home/ubuntu/backups/send-to-t3-code/releases/2.35.7/smoke-vps-qlo2-desktop.json`.
Its evidence manifest records checksums for the logs, screenshots, final proof,
Sync fixture and migration audit under
`/home/ubuntu/backups/send-to-t3-code/storage-lifecycle-20261008/`.

