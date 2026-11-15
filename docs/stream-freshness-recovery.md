# Recovery from a stalled response feed

Device-local responses share one source per environment, project and thread.
Returning to the foreground requests one current canonical snapshot per active
source. The existing response tick also checks sources with no transcript data
for ten seconds, including protocol v2 streams. Socket pings do not postpone this
check. A successful quiet snapshot starts a fresh ten-second window.

Recovery reads are shared across attached views. Each tick queues all eligible
sources before assigning its two read slots, so the visible note can precede
background notes regardless of source insertion order. Each source has at most
one in-flight read. A read
that hangs for thirty seconds is expired by the existing tick; late results are
fenced even when its transport ignores cancellation. Failures back off from five
to thirty seconds. Completed-only history retains its bounded one-shot retry.
Stopping the last reader or disposing the plugin cancels pending recovery.

A higher global snapshot cursor alone does not prove a missed thread update.
Recovery compares the canonical thread content with the already bounded cached
snapshot and live events, ignoring cursor changes and object key order. It does
not retain a second transcript. A snapshot that proves the live feed missed
newer thread state refreshes the ordinary
response projection, then reopens the subscription at the readers' current
cursors. A current quiet stream keeps its socket. Exact-message bindings,
sequence checks, canonical final-item verification and checked native note IO
continue to decide completion; recovery does not grant write authority or reload
the app.

`scripts/benchmark-sync-stream.mjs SOURCE_ROOT EXTERNAL_REPORT.json` records
synthetic foreground recovery, a silent feed, a controlled busy-Sync final save,
and repeated Smart Send preparation. Stream/save latency uses simulated time;
Smart Send timings use the host's monotonic clock. These are reproducible
regression measurements, not native iPhone or live network latency claims.

For a disposable native desktop check, build with
`node scripts/build-sync-stream-lab.mjs EXTERNAL_EVIDENCE [SOURCE_ROOT] [--baseline]`,
then run `node scripts/run-sync-stream-lab.mjs EXTERNAL_EVIDENCE UNIQUE_SESSION_KEY`.
The Linux runner needs `t3-session`, Xvfb and `/opt/Obsidian/obsidian`. It starts
its own display, profile and synthetic vault, and refuses reuse of prior results.
The fixture tests foreground recovery and busy-Sync final saves, injects an
atomic-boundary note change, and checks that unsaved typing survives the retry.
It records source hashes, screenshots and note/process cleanup. Its T3 snapshots
and busy-Sync hint are controlled inputs; this does not test a native Sync engine.

`node scripts/benchmark-settings-save.mjs SOURCE_ROOT EXTERNAL_REPORT.json` uses
that root's existing `dist/main.js` with synthetic history and in-memory plugin
IO/IndexedDB. It records save time, shared writes, serialized bytes and the
production bundle hash. Build each source root before comparing its results.
