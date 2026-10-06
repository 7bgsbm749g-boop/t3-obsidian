# Retroactive T3 run import

The prerequisite thread `88f70dc1-8a97-58dc-884c-beaae68b35a7` completed
release 2.33.7. Its terminal result and clean canonical checkout were read before
implementation; no input was sent to that thread.

A Markdown editor now exposes **Import T3 run into this note…**. The source
project/machine, thread, run and confirmation are explicit. The source selection
is independent of the destination note's folder routing. Import never calls a
turn start, steer, project creation or note-send operation.

`run-import.ts` requires full history and an exact prompt-to-turn association.
Existing binding checkpoints can recover earlier associations and completion
records. The retained explorer index is necessary because the active lease
catalog removes terminal responses. Same-turn steering is not a separate run.
Missing associations and unverifiable old lifecycles remain visible as
Unavailable, with no attach action. This does not add missing historical records
to T3 itself.

A version-4 hosted request carries exact `importTurn` evidence, preserving the
selected old lifecycle against an unrelated newer snapshot. Existing writers,
leases, native projection, checked commits and response presentation handle the
catch-up, live output and completion. Deterministic per-source/run/note binding
identities and retained response records prevent repeat imports after reload.

Optional future-thread following defaults off. It reuses enabled registrations,
resumes paused ones and starts with `future`, excluding existing user messages.
The management modal pauses/resumes a registration or removes only this note.
Already attached child responses continue normally.

Tests exercise the bundled plugin and writer, including picker confirmation and
cancellation, live catch-up and completion without dispatch, duplicate recovery
after reload/user edits, terminal evidence outside the active catalog, future
registration reuse/resume, unavailable history and wrong-project rejection.
Real-client evidence is recorded separately through the immutable release tool.
Native mobile behavior requires an affected device and is not established by
these desktop tests.

The first live pass (2.34.0) verified completed import through the editor UI,
future attachment of two subsequent T3 runs, a separate live catch-up import,
completion, preservation of an ordinary note edit, and byte-identical repeated
import after a native client reload. Review found that a removed destination
could replay its previous deterministic follow-command receipt. Re-enabling
future following now retains removed/cancelled history to choose a new command
identity. The bundled integration test covers both removal and cancellation.
The immutable 2.34.0 bytes remain unchanged; delivery continues with a newer
patch release and a fresh client check.

Release **2.34.1** is complete. Build and the full suite passed (900 TypeScript
tests and 11 Python tests). The release tool installed the immutable artifacts
into both vaults, preserved each installation's device settings, and completed
the fresh QLO2 Sync scan. A native QLO2 reload loaded 2.34.1 in client instance
`dbc2d8cb-be0e-46a9-b083-a6d3c556b9ef`.

The fresh client check renewed a removed future registration with a new ID,
left the duplicate note bytes unchanged, attached a subsequent real response,
and imported that response through the UI while it was running. Both notes
received the final answer. Four bounded synthetic prompts were sent explicitly
for the entire smoke pass; importing sent none. The earlier 2.34.0 evidence
records visible live commentary/tool catch-up and preservation of a surrounding
note edit. The 2.34.1 evidence records running selection, exact running lifecycle
seed, and final delivery; it does not add native mobile coverage.

The synthetic tabs, notes and following registrations were cleaned up. The
original note and command-line-disabled setting were restored, and the
originating investigation note's stream was preserved. The prerequisite started
another read-only turn during smoke testing; no further source or release edits
were made until its terminal result was read again. No communication was sent
to that thread.

Immutable release evidence:
`/home/ubuntu/backups/send-to-t3-code/releases/2.34.1/smoke-vps-qlo2-run-import-evidence.json`.
The artifact directory is
`/home/ubuntu/backups/send-to-t3-code/run-import-20261006`.
