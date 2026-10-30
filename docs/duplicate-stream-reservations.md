# Duplicate streams after importing future runs

Sending from a note and following that thread's future runs can race across
devices. T3 exposes the new run before Obsidian Sync delivers the sending
device's response binding to the watcher. Both paths then attach the same
message under separate binding IDs.

Before dispatch, Send now reserves each response destination and its exact
binding ID through the existing authenticated event-host command transport.
The vault connection machine saves and acknowledges the reservation before
T3 receives input. Future-run discovery combines these durable reservations
with its normal synced bindings. Reservations also cover steering, continuations,
watcher restarts, registrations created later, and note/folder moves. Other
destination notes and replies sent directly in T3 still attach normally.

Reservations contain source IDs, message IDs, note paths and binding IDs, with
no prompt or response body. Repeated commands retain the same identity. A failed
acknowledgement prevents dispatch. Streaming sends with a configured vault
connection machine require its Obsidian event host to acknowledge the stream;
sends without response destinations or without a configured machine retain
their existing path. Existing duplicate response blocks are preserved.

Regression tests cover missing synced metadata, durable restart, later
registration, exact source/destination isolation, storage failure, command
validation, moves and the dispatch acknowledgement boundary.
`validation/stream-reservation-lab.ts` exercises real imports, note sends,
future-run attachment and saved/native editor output in an isolated vault,
while withholding watcher settings discovery to reproduce the timing gap.
