# Final saves and ordinary typing

The completion path now uses the exact app run's terminal event. One bounded
authoritative final-item read supplies the final reply directly; mismatched
preview text does not require a second matching download. V2 completion events
render immediately, and healthy v2 streams stop recurring snapshot polling.
The existing renderer retains the intermediate block, tool history, final reply,
Raw Markdown option, steering and question continuation. Reconnect snapshots,
exact response identities, permanent final-writer grants and immutable save
intents remain in use.

The prior save coordinator compared the entire readback note with its immutable
target. Ordinary typing after a successful disk write could therefore leave a
saved response in conflict. Native IO's verified disk result is now sufficient;
legacy or interrupted attempts also recover by proving the generated ranges in
the actual saved file. This never rewrites a later note merely to restore an old
whole-document checksum. Changed generated output, missing notes and competing
staged edits remain unverified.

Native conflict adoption previously selected disk and discarded local text,
including after every response had completed. Adoption now merges the actual
current typing buffer. Genuine overlapping ordinary edits retain their local
buffer and incoming version; subsequent typing remains available. Native
unload strips transient responses while retaining ordinary text.

The working indicator uses exact run completion independently of pending file
save or acknowledgement. Old completed grants no longer cause Working. The
repeated final-conflict popup is removed. Unchanged completion conflicts do not
repeat note reads; saved-note changes and explicit reviews permit recovery.
First/latest conflict snapshots and referenced originals/proposals bound each
retained history without deleting unresolved recovery inputs. Successful
verification clears obsolete conflicts, followed by normal receipt retirement.

## Validation

Regression coverage includes ordinary typing between write and readback,
recovery of an old false conflict without a new write, terminal activity with
stale Running/Waiting checkpoints, canonical corrections after one read,
immediate completion rendering with collapsed history, late native updates with
zero active responses, typing after a conflict, grant/rename/Stop fencing,
storage compaction and metadata-only maintenance.

The two independent desktop Sync lab editors used the updated fixture with
official Obsidian Headless Sync. Sender B completed and retired its journal
while B Sync was stopped. Typing injected during its final disk write remained
visible and saved, together with collapsed intermediate history and the final
reply. Measured synthetic completion was 260 ms; this excludes real provider
generation and network requests. Receiver A typed independently while waiting
for Sync. After reconnection, both saved files included the sender and receiver
edits, and the already-open A editor adopted them without reload. A later native
file-update echo retained additional typing with zero active response blocks.

Private evidence is retained at
`/home/ubuntu/backups/send-to-t3-code/final-saves-20261013T152340Z`.
The fixture uses synthetic T3 completion evidence and real remote file Sync;
native input, file propagation and editor adoption are distinct observations.
Desktop core Sync and native iPhone/Android behavior are not verified by this lab.

The production build passed. The final complete suite passed with 1,442 TypeScript
tests and 14 Python tests, with CPU affinity limited to four cores for the timing
fixtures. Immutable QLO2 deployment, a real delivery and a
native client smoke receipt remain release requirements.

The first production smoke used real T3 runs in the existing routing test
thread. Final delivery and ordinary typing succeeded, but disk save took about
17 seconds after completion. A retained filesystem event trace of a second run
located the wait in the private host mailbox: `prepare-final` was durable at
15:59:56.969 UTC and its receipt arrived at 16:00:07.512 UTC. The final note write
followed at 16:00:08.058 UTC. The final text check was already finished.

Same-process commands now reach the current local authority directly after
the normal durable mailbox write. The authority still serializes mutations,
checks the exact command, retains the identical receipt and permanent writer
grant, and permits normal crash recovery. The client reads that receipt once;
remote callers retain the authenticated mailbox transport. Mailbox discovery
also reads independent entries in bounded batches of 32, and presence
maintenance uses background capacity instead of occupying the interactive
batch. This addresses the measured queue delay without removing commit proofs.

A native runtime probe found another concrete blocker: the authority was
awaiting removal of an already-answered command file for more than eleven
minutes, with its receipt durable and its command file still present. That
housekeeping promise held the authority transaction and stalled a later registration.
Answered command removal now runs separately, with at most eight tracked
deletions. Answered commands do not occupy the interactive command batch.
Fresh directory discovery drops entries whose files are already
absent even if their callback never arrived. File-only removal uses `unlink`.
Durable lease, proof and receipt writes still complete under the authority
transaction; no uncertain write is cancelled or treated as acknowledged.

Direct same-process dispatch is reserved for interactive commands. Presence,
claim, heartbeat and observation maintenance retain the bounded mailbox path,
so background callers cannot bypass its capacity limit and compete directly
with final-save grants.
