# Streaming host allocation reduction

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
  full string. Undefined optional object fields compare like their durable JSON
  representation. Equal observations retain their existing state references.
  Old turn records and the stream watermark remain merged for canonical catch-up.
- Job and display readers share one canonical read per exact environment,
  project and thread within a serialized operation. Busy checks and dispatch
  validations remain independently fresh.
- Monitor events still save their state and cursor immediately. There is no
  event batching, history truncation, retention policy change or delayed delivery
  checkpoint in this release.
- Canonical reads retain the authoritative snapshot watermark, fencing late
  deltas even after restart. A clock-only advance stays in memory without a
  write; restart resumes from the prior durable cursor and safely replays it.
  Older canonical reads cannot overwrite newer observed state.
- The subscription stream disables its second, recent-history poll. The service
  already polls complete canonical history every second, even during stream
  outages. Ordinary response streams keep their existing fallback polling.
- A save marks state dirty before invoking storage, so a failed checkpoint cannot
  be hidden by a previously recorded error with the same text. Recovery flushes
  the successful attachment receipt without attaching again.

## Validation before release

The subscription revision passed its build and complete suite: **796 TypeScript and 11 Python tests**.
Existing coverage verifies prepared-byte retries, lost acknowledgements, host
restart, feedback suppression, direct actions, stable attachment IDs, pause and
resume, old-turn catch-up and post-move receipt-save failures. New large-history
tests verify unchanged polling and notes, shared reads, failed-save rollback,
durable cursor replay, error recovery and changed canonical history without an
event feed. Additional coverage verifies watermark-only advances, stale canonical
reads, late deltas after restart, and failed post-attachment receipt recovery.

A synthetic benchmark used identical 6,656,325-byte state containing 22 historical
threads, four displays of one thread, 25 unchanged polling/response-only updates
and 25 ordered stream events. It has no vault, credentials, network or dispatch.

| Measurement | 2.31.33 source | Patched source |
| --- | ---: | ---: |
| Writes during unchanged work | 125 | 0 |
| Total writes, including 25 cursor checkpoints | 150 | 25 |
| Canonical reads | 100 | 25 |
| Estimated allocation bytes | 2,337,104,648 | 174,093,752 |
| CPU milliseconds | 7,804.7 | 866.3 |
| Elapsed milliseconds | 7,800.0 | 1,530.7 |

Estimated allocations decreased **92.6%** and CPU **88.9%** in that workload. Both
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

## Live validation exposed a second polling workload

The initial 2.31.34 installation removed the clone hotspot and passed the
installed-class rollback/replay checks and a real synthetic file-action delivery.
It did not finish the live validation: the steady-state sample still allocated
991,080,856 bytes in five seconds, only 6.9% less than the baseline. Its immutable
deployment receipt remains awaiting smoke; the final revision supersedes it.

A bounded four-second trace identified eight full saves. `watchThread`'s default
1.2-second recent-history poll was overwriting complete subscription histories,
including one large thread whose partial snapshots had `historyComplete:false`.
The subscription tick then fetched complete history again. Polling snapshots also
carried changing global sequence watermarks unrelated to new messages. Both
histories repeatedly changed their stored representation even while idle.

Removing that second subscription poll preserves the service's existing canonical
recovery path and the websocket live/replay connection. Retaining the stream
watermark and comparing optional fields as durable JSON removes additional
representation-only writes. Regression tests cover unchanged streamed/canonical
snapshots, the stream's disabled-poll/reconnect mode, and repeated post-attachment
storage failure. The final full suite and real-client measurement are recorded
with the completed final release below.

## Remaining native allocation paths

Loaded 2.31.35 produced zero subscription writes during a 4.5-second idle trace,
retaining all 22 histories, 17 subscriptions and 8 displays. The isolated installed
class passed rollback, replay and zero-write tests; a real temporary QLO2 note
received one durable property action. However, the overall five-second allocation
estimate was still 1,033,046,636 bytes (only 3.0% below baseline). RSS was 568 MB,
but a reload and a short sample do not establish an OOM fix. Its deployment stays
awaiting smoke while the remaining identified paths are addressed.

The next revision uses the platform UTF-8 decoder for bounded HTTP bodies,
avoiding the browser Buffer polyfill's intermediate code-point arrays. It retains
the existing 4 MB byte limit, replacement-character behavior and BOM handling.
Journal validation reuses verified paths and compares nanosecond file identity
fields directly instead of reconstructing path and signature strings for every
revision on every read. Every revision still receives a fresh `lstat`; hash-chain,
replacement, truncation and symlink checks remain intact.

A separate synthetic decoder benchmark used 25 identical 680,011-byte JSON
bodies through the actual browser-bundled HTTP function. Estimated allocations
fell from 541,260,840 to 52,331,288 bytes (**90.3%**); CPU fell from 663.1 to 232.6
milliseconds (**64.9%**). Decoded data was identical. `http-decoder-benchmark.mjs`
and both browser bundles/results are retained in the evidence directory. This is
component evidence, separate from the real-client allocation sample.

The final allocation revision passed its build and complete suite: **801
TypeScript and 11 Python tests**. New HTTP tests cover split multi-byte text,
replacement characters, BOM rejection and declared/streamed byte limits. Journal
tests confirm cached paths still reject symlink replacement and malformed names;
the existing same-size tampering, changed hash and truncated-chain tests pass.
