# Orchestrator v2 release 2.36.1

The source checkout was clean before this work. The implementation uses T3
`v0.0.46-nightly.20261008.2849` contracts. The immutable release was built from
commit `0127a8ca1a7e670b4cafa322e32796e44970fd65` and completed its real QLO2 smoke
test on 2026-10-09. Release 2.36.0 remains immutable and is superseded.

## Verified behavior

- Build, 1,122 TypeScript tests and 11 Python tests passed. The existing suite
  covers desktop and mobile bundles, routing, response storage, subscriptions,
  questions, approvals, Stop and recovery. New tests cover v2 wire contracts,
  app run identity, history paging, image persistence and v1 migration.
- A bounded live T3 test created a thread, received authenticated v2 events,
  completed two exact replies, stored a real image, and interrupted an app run.
  Its temporary CLI credential was revoked.
- A real QLO2 client reloaded the exact 2.36.1 runtime hashes through the guarded
  reload command. A new client instance reported loaded version 2.36.1.
- Same-thread text and image deliveries completed through the real plugin.
  T3's exact user, app run and final assistant IDs matched the expected replies.
  Each response lease was complete; each device journal was verified. Saved
  documents matched the completion proofs, and replies were visible in Obsidian.
- The release installer preserved both installations' `data.json` during
  installation. A fresh official Headless Sync scan reported `Fully synced`,
  and the continuous Sync service was active after testing.
- Temporary notes and the synthetic image were removed. The original saved
  note matched its initial SHA-256 and was reopened in the real client.

## Limits and incident

The laptop reload remains pending because its transport timed out. Its existing
retry timer will check again. Native iPhone and Android behavior was not tested.
Desktop tests of the mobile bundle do not establish native mobile behavior.

During the initial client reload checks, the old Obsidian renderer exhausted
memory and Linux killed it. The cause of its memory growth is not established.
The old process exited before the new QLO2 client was launched. The original
saved note was restored to its exact initial hash; other unsaved buffers could
not be checked in the stalled client. The new client passed the live checks
without current memory pressure. The temporary recovery swap file was removed.

## Evidence

The immutable smoke receipt is
`/home/ubuntu/backups/send-to-t3-code/releases/2.36.1/smoke-vps-qlo2-desktop.json`.
Its copied evidence records runtime hashes, terminal response proofs, screenshots,
test logs, cleanup, Sync and the memory incident. Evidence SHA-256 is
`02d9b1092ac435e416061e06dfc434ee005b42e8f9e75386d478604b30654963`.
The source files remain documented in [orchestrator-v2.md](orchestrator-v2.md).
