# Subscription state allocation reduction

Linux killed QLO2's renderer for memory exhaustion on 2026-10-05. The preceding
[investigation](auth-recovery-and-memory-20261005.md) identified repeated copying
and saving of a 6.5 MB private event state as a major allocation contributor.
A fresh five-second profile of loaded 2.31.33 reproduced approximately
1,064,870,212 bytes of estimated allocations. Whole-state cloning and saving
again led CPU self samples. These are temporary allocations, not retained heap.

## Preserve the safety boundaries

The store carries subscriptions, pending notifications, immutable prepared
commands, feedback suppression, display bindings, full cached thread histories
and replay positions. Durable preparation before dispatch/attachment and saved
receipts afterward prevent losing work or creating duplicate replies.

The patch keeps the existing version-1 storage format and histories:

- `serialize(..., false)` no longer allocates a backup it cannot use.
- Rollback still deep-copies mutable control records and baseline maps. Thread
  records use a shallow table checkpoint because `applyThreadItem` and canonical
  reads replace records rather than mutating previous histories. A failed stream
  save restores both state and its replay position.
- A dirty flag records changed observations, effects and errors. Unchanged ticks,
  repeated observation errors and response-only note changes skip persistence.
  Successful saves clear the flag; failed tick saves retain recovery state and
  flush it before continuing, preserving the existing post-effect recovery path.
- Canonical snapshots are compared as plain JSON data without encoding another
  full string. Equal observations retain their existing state references. Old
  turn records remain merged for canonical catch-up.
- Job and display readers share one canonical read per exact environment,
  project and thread within a serialized operation. Busy checks and dispatch
  validations remain independently fresh.
- Monitor events still save their state and cursor immediately. There is no
  event batching, history truncation, retention policy change or delayed delivery
  checkpoint in this release.

## Validation before release

The build and complete suite passed: **791 TypeScript and 11 Python tests**.
Existing coverage verifies prepared-byte retries, lost acknowledgements, host
restart, feedback suppression, direct actions, stable attachment IDs, pause and
resume, old-turn catch-up and post-move receipt-save failures. New large-history
tests verify unchanged polling and notes, shared reads, failed-save rollback,
durable cursor replay, error recovery and changed canonical history without an
event feed.

A synthetic benchmark used identical 6,656,325-byte state containing 22 historical
threads, four displays of one thread, 25 unchanged polling/response-only updates
and 25 ordered stream events. It has no vault, credentials, network or dispatch.

| Measurement | 2.31.33 source | Patched source |
| --- | ---: | ---: |
| Writes during unchanged work | 125 | 0 |
| Total writes, including 25 cursor checkpoints | 150 | 25 |
| Canonical reads | 100 | 25 |
| Estimated allocation bytes | 2,337,104,648 | 175,040,296 |
| CPU milliseconds | 7,804.7 | 749.6 |
| Elapsed milliseconds | 7,800.0 | 739.4 |

Estimated allocations decreased **92.5%** and CPU **90.4%** in that workload. Both
runs retained identical history hashes and the saved cursor reached 25 after
each event was checked. The remaining 25 writes are intentionally preserved
durable event checkpoints. This benchmark does not predict total Obsidian RAM
or laptop-to-VPS latency; HTTP decoding and unrelated file scans remain.

Retained evidence and reproducible scripts:
`/home/ubuntu/backups/send-to-t3-code/memory-fix-20261005T193948Z/`.
`benchmark.mjs`, `bench-before.mjs`, `bench-after.mjs`, benchmark JSON/allocation
profiles, full test/build logs and the real-client `before/` profile are retained.
The native transport is `native-obsidian-cli.py`; its supported CLI connection
keeps stdin open until asynchronous replies arrive. Profiling uses the verified
QLO2 renderer's Electron debugger through that CLI and detaches its own debugger
after each sample. No heap objects or credentials are captured.

Real-client post-release results and the immutable smoke receipt are recorded
after deployment; source tests alone do not establish live delivery.
