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
