# Recovery from a stalled response feed

Device-local responses share one source per environment, project and thread.
Returning to the foreground requests one current canonical snapshot per active
source. The existing response tick also checks sources with no transcript data
for ten seconds, including protocol v2 streams. Socket pings do not postpone this
check. A successful quiet snapshot starts a fresh ten-second window.

Recovery reads are shared across attached views, prioritize the visible note,
and run at most two at a time. Each source has at most one in-flight read. A read
that hangs for thirty seconds is expired by the existing tick; late results are
fenced even when its transport ignores cancellation. Failures back off from five
to thirty seconds. Completed-only history retains its bounded one-shot retry.
Stopping the last reader or disposing the plugin cancels pending recovery.

A snapshot that proves the live feed missed newer state refreshes the ordinary
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
