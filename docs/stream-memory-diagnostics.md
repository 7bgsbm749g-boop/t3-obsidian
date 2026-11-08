# Streaming memory diagnostics

In **T3 Code → Advanced → Troubleshooting**, enable **Streaming memory logging**
on the affected device. Connection and Response logging add connection identities
and render/save timing. Leave Follow off unless scroll behavior is relevant.
All switches default off and use Obsidian device-local storage, not `data.json`.
They do not require a reload. Turn each switch off to stop its collection.

Use **Diagnostic log → View log**, or the **T3 Code: Export diagnostic log…**
command. Export makes a manual memory checkpoint when memory logging is on.
The checked T3 Connect command route also supports device-specific activation:

```sh
python3 scripts/obsidian-command.py --vault /absolute/vault diagnostic-settings \
  --diagnostic-preferences '{"connection":true,"response":true,"memory":true}'
python3 scripts/obsidian-command.py --vault /absolute/vault \
  --output /external/evidence/sample.json send-failure-log
```

Add `--client-id DEVICE_UUID` where more than one device matches. Read settings
with `diagnostic-settings` and no preferences. To stop memory collection, send
`{"memory":false}`; this preserves other switches and the bounded prior journal.
This uses the existing checked command-file protocol with unmodified T3 Code.
No server endpoint, listener or privileged runtime bridge is added.

## Bounds and interpretation

Collection runs at existing source, render, save and native-view lifecycle events.
There is no sampling timer. One shared activity sample is allowed per five
seconds. Explicit start/end, view open/close, save, disposal, enable and manual
checkpoints share a separate cap of eight per five-second window. A skipped
checkpoint count appears on the next accepted record. With logging off, suppliers,
clock and heap reads do not run. No diagnostic callback or editor reference is
retained. No DOM scan, note serialization, forced GC or content copy is used for
counting. Existing strings use `.length` (UTF-16 code units, **not allocated bytes**).
Counts include shared sources/readers, queued openings, canonical reads, replay
cache characters; direct render body/message/activity counts and timing; native
view document length, retained preview text, proofs and save fences. Fields vary
by checkpoint; absent counters are unknown, not zero. Counts of shared strings
can overlap and must not be added to estimate allocation.

Chromium `performance.memory` is feature detected. Heap values are browser-reported
used/total/limit bytes and can be coarse or shared between contexts. A missing,
invalid or denied API is `unsupported`. This is **JS heap**, not process RSS.
Process RSS and cgroup charge are explicitly `unsupported` in plugin events.
Use short, external, read-only `/proc/PID/status` and cgroup `memory.current`
observations with UTC timestamps and process start identity to correlate them.
RSS can contain shared pages; a cgroup can contain multiple processes. Do not
sum overlapping values. Do not infer a leak or cause from a single sample.

All categories share a device-local journal capped at **512 events, 256,000 UTF-8
encoded event bytes, seven days**. Exports add bounded metadata and JSON formatting
and can be larger than the encoded event cap. IDs, UTC time, monotonic time,
plugin version and device/session identity permit correlation without message
text or credentials. New events evict old ones. Local IndexedDB writes coalesce
while a write is active and serialize bounded journal snapshots. There is no
flush timer. A sudden process/OS failure can lose the final in-flight write;
`storageError` reports detected persistence failures. Logging is opt-in and has
bounded, nonzero journal/storage cost. No native mobile RAM claim is made.
