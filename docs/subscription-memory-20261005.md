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

## Final real-QLO2 validation: 2.31.36

Source commits: `97f194f` (subscription copying/saves), `93704da` (duplicate polling
and watermarks), and `fba21c1` (HTTP decoding and journal allocation).
The final immutable package came from the clean `fba21c1` checkout. Deployment
preserved `data.json`, completed a fresh official Sync scan and restarted the
continuous service. A guarded `reload-client` replaced client
`bcb6a353-d760-4f2a-9ac2-98bc9249a797` with
`2cc6e44e-4254-4651-b4b9-0523d0424840`, reporting loaded 2.31.36.
The final response-host status has recovered authority, zero pending storage
operations and zero timeouts.

Two five-second native allocation samples produced **652,595,132** and
**649,151,816** bytes, versus **1,064,870,212** at loaded 2.31.33: reductions of
**38.7%** and **39.0%**. These are whole-renderer estimated allocation samples,
separate from the larger component benchmark savings. The second sample ended
with 116,945,108 bytes of used heap. A one-minute observation ranged from
509,235,200 to 692,273,152 bytes of renderer RSS. This is short-run evidence;
it does not establish a long-duration OOM guarantee or laptop send latency.
The host still performs file integrity checks and reads response records.

The actual loaded subscription class retained 22 synthetic histories, produced
zero writes for ten unchanged ticks, shared ten canonical reads across four
displays, rolled back a failed save, resumed at cursor 41 and ignored duplicate
replay. A separate real Vault modify event delivered exactly one durable
`set-property` action into `T3 memory smoke 20261005-23136.md`. Its visible checkbox
and preserved before/after body were inspected in the native client. The owned
subscription was cancelled and the temporary note/pane removed afterward.
A 4.5-second idle trace of the real service produced **zero writes** with all
22 original histories, 17 subscriptions and 8 displays retained.

All 19 original pane identities and the original active source pane were restored.
The app, community-plugin and global Obsidian settings are byte-identical to the
initial snapshots, including restoring the temporary native CLI flag to off.
The original purchase note, failed command `681e6bc2-f8a3-4e6f-b5e0-c38a35d905cd`
request/result and original response requests `e25b4b29-1ba8-5179-bcdd-ad63854b6fb5`
and `6de3ba50-b5ec-5963-a6d4-1db7176bb004` passed hash preservation checks.
No original failed command was retried and no purchase action occurred.

The laptop transport was unavailable. Its 2.31.36 reload remains queued under
status ID `7915b450-5ec1-43e2-818e-e5c3580c5768`; no Windows UI or end-to-end
55-second timing result is claimed. The local VPS QLO2 client supplied the live
memory smoke. Versions 2.31.34 and 2.31.35 remain immutable intermediate installs
with awaiting-smoke receipts, superseded by the completed final revision.

## Native inspection and retained handoff

Supported native CLI route (temporarily enabled through Settings → General →
Advanced → Command line interface):

```sh
DISPLAY=:99 XDG_RUNTIME_DIR=/run/user/1000 /opt/Obsidian/obsidian vault=QLO2 eval code=...
```

`final-23136/native-obsidian-cli.py` keeps stdin open while waiting for asynchronous
CLI replies. `dev:screenshot path=ABSOLUTE_PATH` supplies native screenshots.
The retained profile script uses the real renderer's
`window.electron.remote.getCurrentWebContents().debugger`, attaches its own
debugger only when necessary and detaches it afterward. No external CDP listener,
credentials or heap-object dump is required.

GUI control used the installed `mcp__vps_computer__*` Cua tools with session
`memory-qlo2`, the local `~/.cache/cua-driver/cua-driver.sock` backend and X11
display `:99`. At verification, QLO2's main process/window were PID 2440332 and
window 6291459; rediscover them with `list_windows` before reusing the route.
AT-SPI supplied only window metadata, so fresh window screenshots grounded
window-local input. The separate Settings window was closed after CLI restoration;
the owned Cua session was ended. Other Obsidian clients were preserved.

Retained smoke scripts, profiles, screenshots, cleanup/preservation proofs and
logs are in:
`/home/ubuntu/backups/send-to-t3-code/memory-fix-20261005T193948Z/final-23136/`.
Immutable final smoke receipt:
`/home/ubuntu/backups/send-to-t3-code/releases/2.31.36/smoke-vps-qlo2.json`.
Its evidence ZIP includes the reproducible scripts, before/after profiles and
validation records; raw settings backup files are excluded.
