# Silent T3 file connections and recovery

## Confirmed observations

The laptop send failures on 2026-10-10 occurred during response registration,
before prompt dispatch. Each file request waited 15 seconds. Failed-response
cleanup then waited about 30 seconds. The old file connection remained cached
because the browser had not reported a close or error. Reloading Obsidian created
a fresh connection, and the user confirmed that the next send succeeded.

Fresh authenticated relay reads took less than a second in the investigation.
The evidence supports a stale silent socket. It does not identify the original
network event that made that socket silent. Sleep, network changes, and relay
interruptions are possible triggers, but none was established from these logs.

The plugin answered incoming `Ping` frames but never initiated a health probe.
The T3 Effect RPC server answers a client `Ping` with `Pong`; it does not initiate
that exchange for this client. A request deadline did not invalidate the socket.
These two defects let later attempts reuse a connection that could not reply.

## Recovery behavior

`connectT3Rpc` sends `Ping` after five seconds without a valid reply and waits
three seconds for `Pong` or a matching RPC result. Silence closes the socket and
rejects pending requests with a confirmed connection error. A suspended client
checks an idle connection before sending the next file operation. All concurrent
requests share one probe. Timers and pending work are cleared on close.

The existing 15-second request deadline remains for a slow operation on a
responding transport. It first checks connection health. Such an operation gets
an ordinary request timeout; it does not close a healthy shared connection.

The response manager replaces a closed connection. Read-only file operations
can retry once on that fresh connection. Uncertain writes and prompt dispatches
are never automatically repeated. Existing immutable command and message
identities remain in use.

The desktop fallback requires confirmed failures on two distinct connections
to the same host within 60 seconds. Multiple requests failing on one connection
count as one incident. It invokes the native **Reload app without saving** command
immediately. Unsaved Markdown or code edits, active sends, dialogs, final-save
recovery, and changed runtime files never block this reload. A successful host
read cancels a pending fallback. One reload is allowed per outage, with a
five-minute minimum after recovery to prevent an endless reload loop. State is
device-local; mobile gets transport recovery without an app reload.

## Imported stream recovery after a missed rename

The affected note `Fix Laptop Send Timeout and Recovery.md` retained the exact
empty response markers, while its host retained 379,815 characters of running
response text under the original `Untitled.md` destination. The editor had kept
its rename mapping in memory. After reload, native discovery found the renamed
note but adopted the unchanged host path. Native observers never take the legacy
writer lease that would otherwise correct that path. The resulting projection
had no matching open destination, so the stream appeared empty.

Open saved response anchors now supply discovery IDs independently of the local
preview cache. This also handles reload before an asynchronous cache write has
finished and completed bindings outside the active catalog. Discovery uses the
existing unique-marker locator, then asks the authority to relocate the binding
to the verified note before restoring the native display and direct feed.
Missing or duplicate markers cannot authorize relocation. The original request,
message, and turn identities stay unchanged; recovery dispatches no prompt and
never delays the native reload command.

## Verification

### Renderer allocation pressure

The QLO2 renderer reached about 4.4 GB before Linux stopped it for lack of
memory. After restart, native diagnostics showed 486,212 source file reads,
152,508 lease parses, and 1.17 GiB of used JavaScript heap. A short native
allocation sample attributed 49.75% of sampled allocations to
`LeaseRecordCache.read`, called from `CoordinatedHost.scanRecords`, and 12.51%
to `DeviceInlineManager.observeCoordinated`. These are allocation measurements,
not a complete retained-object analysis. Private evidence is in
`connection-recovery-20261010/renderer.heapprofile` under the backup root.

Discovery reread every historical lease on each live scan. History exceeded
the 16-million-character cache budget, so many unchanged bodies were repeatedly
read and decoded. The desktop host now checks a fresh regular-file identity
before reusing its existing decoded snapshot. It checks the identity again
after a new read before admitting that snapshot. Same-size or same-mtime edits,
replacements, removed files, and symlinks retain fresh-read behavior. The
metadata index has a 4,096-entry limit and clears on host shutdown. Changed
leases still bypass historical maintenance limits immediately.

The real QLO2 2.37.4 client reduced lease discovery parses from about 129 per
second in the first old-client interval to 1.4 per second after warm-up. Total
CPU and memory remained high; this does not prove all renderer costs were
removed. A second native allocation sample attributed 14.31% of sampled
allocations, including child calls, to preview checkpoint construction and
validation. Preview equality serialized two complete copies of each body,
and metadata-only revisions could repeat Markdown validation after cache
eviction. Preview updates now compare fields directly and reuse boundary
validation only for the same binding and exact body already checked in this
process. New text and persisted snapshots still receive full validation.
Metadata and cache size limits remain checked on every update. Native V8
diagnostics found five contexts and zero detached contexts; these measurements
do not establish that a full retained-object leak has been ruled out.

Regression tests include history that exceeds the text-cache budget, changed
terminal revisions, deletion, a replacement during discovery, and real file
identity checks. This reduces repeated history allocations without enlarging
the body cache or delaying reloads. Preview regressions cover cache eviction,
metadata-only revisions, changed identity fields, unsafe paths, nested response
boundaries, and untrusted persisted snapshots.

Regression tests cover silent sockets, real health responses, slow healthy
requests, shared probes, concurrent reads, uncertain writes, recovery cancellation,
unsaved edits, changed runtime files, and reload limits across app instances.
Failure records include method, connection ID, elapsed time, pending count and
last-reply age, without storing prompts or credentials.

The read-only `validation/connection-health-live.ts` check uses a short-lived
scoped session against the actual relay and revokes it in a finally block. It
confirms the server responds to Ping, drops incoming frames on its test socket,
and checks confirmed closure followed by a successful fresh read.

The synthetic real-Sync lab uses the actual plugin in two independent Obsidian
desktops. Its test-only observer can leave one or every file socket OPEN while
dropping its outgoing frames. A single silent connection recovered and delivered
one bounded prompt without restarting the app. Repeated silent connections
caused a native reload; the new client then recovered. The exact reply
reached both saved notes and both visible editors through official Headless Sync.
Private records and screenshots are retained outside the vault under
`/home/ubuntu/backups/send-to-t3-code/connection-recovery-20261010`.

The rename regression used two real imported runs. For the active run, the lab
missed the rename handoff, erased the local preview checkpoint, then invoked the
native reload during generation. The new client restored the unique anchor,
corrected the host path, and retained the original message identity. All 750
final response lines reached both saved notes; both desktop editors visibly
showed the final line. The lab runtime files were restored with exact hashes,
temporary notes removed, and its temporary authenticated session revoked.
Evidence is retained under
`/home/ubuntu/backups/send-to-t3-code/reload-stream-20261010/live-smoke.json`.

This proves real relay RPC, desktop recovery, file propagation, and visible
editor adoption. It does not establish the desktop core Sync engine or native
Android/iPhone behavior. Windows receives the immutable release through the
existing Sync and native laptop reload path; the two-client fault test runs on
Linux desktop clients.

### Further recovery allocation reductions (2.37.6)

The next live-client sample still used about one CPU core. The running journal
had made more than 100,000 mutable recovery copies. Its active catalog included
large originals, so copying a verified state just to check a path or status
allocated large strings again. Increasing the cache budget would retain more
memory, and an LRU over the whole active set could make every scan miss.

`CurrentGenerationJournal.inspect` instead performs the same fresh head,
publication-anchor and object checks, then returns its existing deeply frozen
hydrated state. Host discovery, event-content inspection and the device draft
read use this method. Journal mutation and coordinator operations still obtain
independent mutable copies. Cache entry and character budgets are unchanged.
Regression tests verify reuse without copies, nested immutability, changed
publications, same-size replacement and object tampering, and successful final
completion after repeated host inspection.

Native recovery-anchor discovery previously ran on every 150 ms writer tick,
even though host catalog discovery was already paced at three seconds. It now
runs with the existing one-second native view refresh, and immediately on
workspace/file and resume events. Stream projection changes and the writer's
150 ms cadence are unchanged. Saved anchors still recover imports independently
of preview persistence. No edit, save or active-work guard was added to reload.

Incoming reply and lease updates now refresh only panes for the affected
binding's old/current destinations and duplicate-location warnings. They no
longer read every unrelated native note. Full workspace/periodic refreshes still
discover changes, and all panes showing the affected note update immediately.
Tests cover unrelated-note reads, full refresh, and delayed leases after rename.

Live before/after resource samples and the release smoke evidence are retained
outside QLO2 under `performance-20261010-even-more` in the backup root. Resource
samples describe the entire Obsidian renderer and include core application work
and other plugins; they do not by themselves establish a retained-memory leak.

### Title listeners without duplicate history polling (2.37.7)

The 2.37.6 live sample reduced mean renderer RSS from about 1.76 GiB to
1.30 GiB over matching 20-second windows, but total CPU remained about one
core. This is a short natural-GC sample, not evidence that retained memory
stays bounded indefinitely.

Each open thread also had a separate title listener. It polled and normalized
canonical history independently of reply recovery, then discarded all messages
and activities. Title listeners now use the stream's initial snapshot and title
events, with no second history poll. Every reconnect requests a fresh snapshot
rather than replaying a title cursor. Their normalization reads only thread
identity, title and sequence; it does not inspect or retain duplicate messages,
tool output, runs or request controls. Reply and recovery polling is unchanged.

The title feed retains its protocol version with its cursor, so a delayed v2
snapshot cannot reset that cursor and replace a newer title. Tests cover stale
snapshots/events, project/environment isolation, fresh reconnects, stream
acknowledgements, absence of title history polls, and history/payload getters
that fail if title normalization touches transcript data.

The final 2.37.7 VPS native smoke completed one prompt and one T3 run, saved
the exact expected reply and displayed it in the editor. The original note was
restored, its saved hash and the active import's saved hash stayed unchanged,
and the synthetic test note was removed. Both VPS and Windows clients confirmed
2.37.7 in new instances. Windows resource use and native mobile behavior were
not measured.

Two final 20-second renderer samples averaged 1.45 GiB RSS, versus 1.76 GiB in
the fresh 2.37.5 baseline (about 18% less). CPU ranged from 74.66% to 97.80% of
one core; earlier warm 2.37.6 samples also varied. These short natural-GC samples
include core Obsidian and other plugins and do not establish a repeatable total
CPU reduction or a long-run retained-memory bound. The synthetic normalization
benchmark confirms that title processing skips transcript work, but excludes
network, JSON decoding and the rest of the renderer. Raw samples, benchmark,
screenshots and exact delivery proof are retained in
`performance-20261010-even-more/title-only-2377` outside the vault.
