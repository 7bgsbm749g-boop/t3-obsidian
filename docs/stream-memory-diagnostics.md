# Automatic diagnostic log files

Diagnostic history is saved automatically. Agents read ordinary JSONL log files;
there is no export step. All recorded history is retained until the user deletes
it. There is no total event, byte, or age retention limit.

On the connected local T3 machine the stable directory is:

```
<T3 No project workspace>/.t3-obsidian/diagnostics/<vault UUID>/<device UUID>/
```

Each dated subdirectory contains JSONL segments, one JSON event per line. `log.json`
identifies the format, directory, stored event count and file-write errors. Agent
files can be read while Obsidian is closed. The existing checked `client-status`
command also returns `diagnosticLog` with the exact machine, workspace and directory.
Agents should inspect the newest relevant segments when asked about an issue;
do not ask the user to export or copy logs. Use bounded reads/tails when examining
large histories. Segment boundaries are transfer units, not deletion or retention
limits. Older segments remain available.

On desktop, log routing prefers the explicitly local route or a connected machine
with the same path platform. It waits for that route rather than choosing a remote
machine just because it connected first. Changing the destination copies retained
history incrementally and preserves the previous files.

The plugin uses existing authenticated T3 Connect file RPCs. It adds no filesystem
or process imports, server endpoint, privileged bridge or background daemon.
Nothing is written to notes, `data.json`, or the synced vault. During a connection
outage, all events remain in device-local IndexedDB pages and are copied to files
when that connection returns. Unsent pages survive reloads. Repeated file delivery
updates the same segment rather than appending duplicates. A device storage error
is reported; storage hardware/browser quota failures cannot guarantee retention.

In **T3 Code → Advanced → Troubleshooting**, **Diagnostic log files → Show location**
shows the directory and any write error. Connection, Response and Streaming memory
logging are per-device switches. Leave Follow off unless scroll behavior matters.
Turning a switch off stops new collection in that category and preserves history.
The former Export command now opens the log location; its ID remains compatible.
The read-only command API still provides a recent preview for older tools.

## RAM and work bounds

Only the recent preview is limited to 512 events / 256,000 event bytes / seven days.
That cache does **not** limit retained log files or the local archive. Archive pages
contain up to 32 records. File delivery processes up to four pages per existing
connection tick and is throttled to at most once per five seconds. It never reads
or serializes the whole history. There is no new polling/sampling timer.

Memory collection runs at existing stream/render/save/view events. One shared
activity sample is allowed per five seconds, plus at most eight explicit lifecycle
checkpoints per five-second window. Disabled memory logging performs no clock,
heap or counter-supplier reads. No editor, note or stream reference is retained.
No DOM scan, forced GC or whole-note serialization is used for counting.
Lengths count UTF-16 code units, not allocated bytes. Shared counters can overlap.

Chromium `performance.memory` reports **renderer JS heap** used/total/limit bytes,
which can be coarse or shared across contexts. Missing or denied APIs report
`unsupported`. Main-process RSS, renderer/GPU/utility RSS and whole-cgroup charges
are separate metrics. External read-only captures should include the complete
Electron family, each PID's start identity and actual cgroup, and relevant cgroup
ancestors. Never add overlapping cgroup charges. Mark policy transitions such as
user-requested uncapped shared apps; `max` is not itself a fault.

UTC and monotonic timestamps, plugin version, device/session IDs, binding/thread
IDs and counters allow correlation without message text or credentials. A short
sample does not prove a leak or the cause of a memory failure. A crash can lose the
last in-flight local write. Desktop proof does not establish native mobile behavior.
