# Plugin background work and memory investigation, 2026-10-07

Language deliveries were held after three kernel OOM events in QLO2. The third
occurred without a build or test running. User notes, layouts, recovery records,
leases, journals and backups remain preserved.

A native 10-second Electron CPU profile and a separate 20-second application
counter sample are retained outside the vault at
`/home/ubuntu/backups/send-to-t3-code/memory-20261007`.
The counter sample observed 956 project-embed preparation calls, 17,745,278
Markdown characters, 231 journal audit requests and up to 26 overlapping audits.
The fresh renderer continued to use approximately one CPU core. A read-only
Windows process sample also found sustained Obsidian CPU activity. These are
measured background costs; they do not establish that every OOM has one cause.

The change caches image-reference syntax, not resources or authorization, under
a one-million-character / sixteen-entry limit. Ordinary reads with no image
opener skip Markdown parsing. Changed text invalidates its entry. Project paths
and signed-image expiration are still checked on each preparation.

Overlapping journal reads share one full audit for the same response. At most
four journal audits run simultaneously. Every audit still checks the identity of
every revision, and changed revision bodies still undergo hash-chain validation.
Callers still receive independent state copies. No journal is deleted or
shortened, and no integrity check is replaced by a directory timestamp.

Automatic host maintenance audits one completed response per five seconds and
avoids repeating an unchanged active lease's journal audit within five seconds.
Active writer polling continues each tick; changed lease revisions bypass that
maintenance delay. Newly completed or changed terminal leases also bypass the
cold-history budget, including native rename and delivery acknowledgements.
Explicit recovery scans retain their original batch size.

Regression coverage checks unchanged/changed image references, cache size/count
bounds, audit coalescing and concurrency, independent read results, historical
rotation and active delivery. Existing tamper, truncation, symlink, recovery and
native-save tests remain required. The immutable release is complete only after
fresh native reload, delivery/link checks and retained memory observations.

A guarded, device-local plugin pause preserved the saved enable list and exact
open-note hash. Over twenty seconds, renderer CPU measured 7.30% of one core and
RSS fell to 501,124 KiB, compared with approximately 1.5 GB before the pause.
The final reviewed build and complete suite passed 976 JavaScript/TypeScript
tests and 11 Python tests. Native post-release observations are recorded in the
immutable release receipt and its retained evidence, not inferred from tests.

## Unchanged checkpoints and repeated failures

Release 2.34.15 passed the checked native reload, signed image, bounded image
cache and real reply save checks. Its immutable complete receipt is
`/home/ubuntu/backups/send-to-t3-code/releases/2.34.15/smoke-vps-qlo2.json`.
The laptop loaded that exact release in a fresh client instance. A sixty-second
Windows sample measured renderer CPU at 0.410 cores, down from 1.20 cores, and
working memory at 401–459 MiB. This is native loaded-version and OS evidence;
Windows visual rendering was not tested. The VPS still had excessive sustained
background CPU, so the memory investigation continued before language work.

Two retained private journal chains had over 11,500 and 9,900 revisions. Their
successive checkpoints differed only by the update timestamp and a repeated
error being cleared and restored. No user response, journal or lease was removed.

The follow-up writer compares durable response contents before saving. It ignores
the update timestamp and a snapshot-only global stream watermark. Unchanged
responses retain the earlier durable cursor, so a restart replays conservatively
instead of skipping lifecycle evidence. Changed prose, exact start sequences,
bindings, turns, recovery checkpoints, errors and delivery proofs still save the
full current state and cursor. Comparison advances only after a successful save.

The writer clears an old error only after the actual note/commit operation
succeeds. An identical unchanged failure waits five seconds before retrying;
healthy responses remain independent. The integrity checks and finished-response
boundary rejection remain intact. Real coordinator regression tests verify no
journal/lease growth over twenty unchanged snapshots, retention of the old cursor,
persistence of meaningful new progress, stable repeated errors, bounded retries
and eventual checked final completion. Existing crash and answer-history recovery
tests remain required. Performance claims require new post-release measurements.

## Reopened history and inferred binding churn

Release 2.34.16 passed a checked native reload and a bounded real final save,
with owned-note cleanup and original notes, leaves and settings preserved. Its
functional receipt explicitly leaves the memory investigation open. A five-minute
VPS sample still measured approximately 1.23 renderer CPU cores. The later laptop
sample remained on 2.34.15 and measured 1.19 cores and up to 1508 MiB working
memory. The initial Windows reduction was temporary, not a sustained resolution.

The native profile showed repeated hashing of immutable historical revisions
after reload. An optional device-local, HMAC-authenticated fingerprint index now
retains verified file identities and hashes across journal reopen. It contains
no note text and is stored outside every vault. Every audit still checks every
revision's fresh nanosecond identity; changed bodies are fully checked against
the original authenticated chain. The last body is read and checked after reopen.
Missing, malformed or unauthenticated caches fall back to full verification;
cache write failure cannot prevent journal operation. Reopen, same-size tampering,
bad authentication, truncation, symlink and cache-publication-failure tests cover
the actual filesystem implementation. Immutable revisions and backups remain intact.

Later native checkpoint comparisons exposed another cause of growth: an inferred
message-to-turn binding was stamped with each global snapshot watermark. Its
sequence now records the association observation and remains stable while that
association is unchanged. Exact start-event sequences and advancing feed watermarks
remain independent. The coordinator regression now uses the actual null-turn-ID
message case that the earlier explicit-turn-ID regression missed.

Unchanged active background maintenance is spaced by thirty seconds. Changed
leases, explicit recovery and active reply polling retain immediate handling.
The existing invalid-final boundary check also runs before private history audits,
rejecting the same unsafe body without repeated large reads. These changes require
new immutable release and native measurements; source tests alone do not establish
that the user's memory problem is resolved.

The reviewed source build and full suite passed 983 JavaScript/TypeScript tests
and 11 Python tests. The earlier interrupted run and the corrected malformed
test fixture are retained in the outside evidence directory. During the old
2.34.16 runtime's later failure, the kernel killed renderer 2913103 with
3,011,204 KiB anonymous RSS at 02:29:57 UTC. The safe-pause request had not
completed. No newer runtime or sustained memory resolution is claimed from it.

## Equivalent JSON field order

Release 2.34.17 completed a checked native reload, a real bounded reply save,
authenticated native history reopen and original-note/tab/settings restoration.
Its complete functional receipt explicitly leaves the memory task open. Native
writer instrumentation was restored in `finally`; it observed writes whose only
value changes were update timestamps and the global snapshot watermark, while
their normalized JSON strings still differed. Equivalent object field order was
therefore still causing false durable changes.

The actual production-coordinator regression reproduces this by returning the
same persisted state with reversed object keys, preserving array order. Before
the correction, twenty unchanged polls increased the journal revision from 3
to 43. The durable comparison now sorts object keys recursively. All meaningful
values and array order remain significant; changed prose still persists its full
checkpoint. The saved recovery cursor continues to advance only with meaningful
state changes. New release and sustained native measurements remain necessary.

The corrected source passed the build and the complete suite: 984
JavaScript/TypeScript tests and 11 Python tests. Both ordered and reordered
persisted-state cases retain unchanged journals and cursors, then save meaningful
new prose. The before/after regression output is retained outside the vault.

After native smoke, 2.34.17 was temporarily paused on the VPS after exact saved
buffer and original-note checks. Its saved enabled setting stayed unchanged,
CLI was restored OFF and Settings closed. The original global config hash was
restored through native Settings without overwriting newer device data. The
laptop's newly installed standard-user Cua diagnostic driver reports a locked
desktop; Windows remains last verified on 2.34.15 until it can receive Sync and
undergo native checks. No Windows input, policy change or forced restart occurred.

## Retry work on retained replies

The native 2.34.18 trace no longer shows timestamp/watermark-only writes. The
four large journals retain their revision counts. This removes the growth
fault but does not establish a CPU or memory resolution: the active native
renderer still uses about 1.3 cores. Its ten-second CPU profile attributes
18 percent of samples to Markdown code-range parsing, often through repeated
note projections and marker searches. The profile is retained separately from
the sustained OS measurement, and its time is excluded from the later quiet
measurement window.

Several retained replies repeatedly return an unsuccessful checked save or
wait for paused boundaries. These paths now use the existing
five-second per-request retry wait, rather than rebuilding the same large
response on every tick. A newly arriving reply remains independent; explicit
Stop continues to bypass the wait. The saved state is retained and the next
attempt reads current data. A real coordinator regression verifies no repeated
attempt or journal growth during the wait, then completes the checked save
while preserving newer ordinary text. Explicit Stop and restored-boundary
tests cover the other deferred paths. New-response acknowledgement and renamed
destination arrival retain their immediate checks: the first targeted run
exposed regressions when those checks were deferred, and that broader change
was removed before release.

Terminal historical replies return before allocating their durable comparison.
An entirely absent native identity and an incomplete legacy region can return
before parsing unrelated Markdown. Native single-boundary, nested and fenced
marker validation remains on the normal path. New native measurements are
required before declaring the memory problem fixed.

The 2.34.18 ten-minute native measurement retained all four large journal
counts exactly. The last five minutes measured 1.295 renderer CPU cores and
767–1153 MiB RSS. The bounded real reply saved exact host hash
`258e0162c4313e8a325e07390a9c4788b4b4b16846781aaa6568f6046763c0c0`.
Own note/tab cleanup and original leaves, physical notes, active note and native
CLI OFF were checked. The functional immutable receipt records these positive
checks and explicitly leaves the memory problem open. A guarded temporary pause
preserved the saved enabled setting before the next source validation.

The narrower retry correction passed all 156 targeted tests, the build, the
full 987 JavaScript/TypeScript tests and 11 Python tests. The two failures from
the discarded broader retry change remain in the outside evidence log.

## Repeated private byte reads and stopped saves

The native 2.34.19 bounded reply saved exact host hash
`4525a073d1fa77f4f6122ebced58df6f4bd75e32a20789b0aee025ec2883bc8b`,
and own note/tab cleanup preserved the original layout and physical note hashes.
Its late five-minute sample still measured 1.289 renderer CPU cores, 743–1143
MiB RSS and 7146 MiB of read characters. All four large journals stayed exactly
unchanged. The restored native final-save instrumentation proved that several
old stopped replies were still retrying more often than five seconds. Functional
smoke remains distinct from a sustained memory resolution.

A later read of the supported laptop-reload service revealed that Windows had
received and loaded 2.34.18 at 03:05 UTC, then 2.34.19 at 03:26 UTC. Those
background loaded-client receipts were not known when the earlier functional
receipt recorded its last verified Windows version. Fresh read-only Windows
checks confirm installed immutable 2.34.19 hashes and loaded instance
`5e3454af-93aa-473c-8dfb-ff3adf77448f`. The 120-second sample measured 0.586
renderer cores and 410–700 MiB RSS, improving on the later 2.34.15 result but
not proving long-term stability. The desktop remains locked; no visible GUI
test, input or capture occurred. The real fleet thread returned HOLD.

The next correction distinguishes a new explicit Stop's immediate priority
from its persistent stopped state. Repeated unsuccessful stopped saves now
wait five seconds after servicing that priority. Completed history is omitted
from reply-writer discovery using the writer's same terminal-state guard;
pending cleanup and legacy questions remain discoverable. History maintenance,
commands and saved records remain intact. Coordinator tests exercise both a
real stopped save with newer outside text and history-only close after writer
discovery stops reading the completed reply.

Desktop inline byte reads now share a bounded process-local cache: at most
4096 entries and 16 million source characters. Every hit requires a fresh
regular-file check of device, inode, size, mode and nanosecond modification and
change times. A source read is cached only if its before/after identities match.
Writes and deletes invalidate their path; symlinks are never cached. The cache
does not persist bytes, weaken path validation, cache authentication or replace
journal integrity checks. Real filesystem tests cover unchanged reads,
same-size/same-mtime changes, atomic replacement, deletion, a concurrent write,
symlink target changes and both storage bounds. Diagnostic counters contain no
paths or content.

Candidate filtering takes one fresh linked-project snapshot per synchronous
operation, after any awaited search, instead of rebuilding it for every file.
Permission checks after I/O stay fresh. A 601-file native bridge regression
checks immediate unlink and revocation during a search. New full-suite and
native measurements remain required before declaring this correction complete.

The first full 993-test run found two synthetic lost-read fixtures that stalled
`readFile` on a nonexistent catalog. The new metadata check correctly returns
missing before that byte-read hook can run. Those fixtures now supply an actual
catalog before injecting the stalled read, retaining their original timeout,
late-result, replay and shutdown-lock checks. All 135 targeted tests passed
against the rebuilt package with those corrected fixtures. The first full run
and corrected targeted result remain retained outside the vault.

The corrected source build and full suite passed 993 JavaScript/TypeScript
tests and 11 Python tests. The next supported clean release repeats both checks
before immutable packaging and installation. Source validation does not establish
the native memory result.

## Idle discovery follow-up

Immutable 2.34.20 loaded on VPS instance
`19ea5a61-2b29-4e66-8683-3f95e48b43a2` and Windows instance
`7035466d-8dc6-4381-83db-768ecdc33a06`. The real bounded VPS reply saved
exact host hash `2d5243b492e5cb9a8ee286046940a4862187cdceb5b53e29aa48eb6c70fd6201`,
preserved its ordinary prefix, and rendered in the native client. Its owned
note/tab was removed and all original leaves and physical preimages remained
unchanged. Initial active CPU remains excessive; sustained measurement is
still required and this is not a memory-resolution claim.

A restored 30-second native trace measured 55 display-binding catalog scans
and 20 coordinated discovery passes. Byte-cache hits avoid source reads but
do not avoid repeated stat calls or JSON decoding. The next correction lazily
reads display bindings only for an eligible attachment or failed-attachment
retry, once per display pass. Future boundaries, attached and skipped bindings
need no discovery. Canonical thread observation continues each tick.

The legacy version-one writer omits known requests of newer versions after
fresh coordinator discovery. Unknown paths and known version-one requests
retain the original behavior. Unchanged completed-history maintenance rotates
one full journal audit every thirty seconds rather than every five. Active
writer ticks, changed leases, native rename acknowledgements and explicit
recovery commands keep their immediate paths; full integrity verification and
the explicit four-record recovery batch remain intact. Passive observation of
unchanged completed history can take longer. No journals or private receipts
are deleted to obtain this change.

Device observations continue to read each authoritative lease every second.
If its exact bytes and the accepted record object both remain unchanged, they
skip JSON decoding, preview updates and ordinary display projection. Any changed
byte re-enters the original receive path, including changes without a revision
increment. An intervening command that replaces the record invalidates reuse.
Authenticated commit delivery, saved-file matching and acknowledgement retry
continue even after an unchanged read. The retained raw byte reference lives
only as long as that active runtime, and is discarded when its job retires.

The complete 2.34.20 functional receipt retains 73 hashed artifacts. Its late
five-minute VPS sample measured 1.093 renderer cores and 806–1250 MiB RSS;
the Windows ten-minute read-only sample measured 0.569 cores and 460–847 MiB
RSS in its late five-minute interval. The four largest journal counts stayed
unchanged. Memory remains open. A checked temporary VPS pause preserved the
saved enabled setting; native CLI OFF, Settings CLOSED and the exact original
global config hash were restored before validation. The idle-discovery and
unchanged-device-observation follow-up passed all 110 targeted tests, including
fresh changed-byte projection without a revision increment, continued saved
commit acknowledgement retries, attachment recovery, immediate changed-history
audits and thirty-second unchanged-history pacing. Build/full validation follows
serially on CPU 0; no language additions are part of this correction.

The corrected build and complete suite passed 996 JavaScript/TypeScript tests
and 11 Python tests on CPU 0. The supported release command must repeat these
checks from the reviewed clean source before packaging the next immutable
version. Native sustained CPU/RSS measurements are still required.

## Durable conflict retries

Immutable 2.34.21 loaded on VPS instance
`833959f1-9770-4aa3-b34e-537b20f91e5f`. The bounded native reply saved exact
host hash `8e1938ed270864b181821e72d6b29189146c4cf4a61498c9e5488e5b5c2c99b4`,
rendered in Obsidian and preserved its ordinary prefix. Own note/tab cleanup
restored all original leaves and physical preimages. A restored thirty-second
trace recorded zero idle display-binding scans, compared with 55 on 2.34.20.
The complete ten-minute VPS measurement still averaged 0.979 renderer cores
and 801–1102 MiB RSS in the late five-minute interval. All four large journal
counts remained unchanged; the memory problem is not resolved.

An initial outside preflight survey mistakenly looked for `t3-response`
markers. A separate corrected survey uses the actual `t3-inline` markers and
shows that the large retained replies still have their anchors. The initial
result was rejected, its evidence retained, and no missing-anchor source guard
was implemented from that result.

The remaining repeated-save path treats a proven durable journal conflict as
running, replacing its useful reason with a generic waiting message. It then
fetches thread history, renders retained prose and audits the journal again.
The next correction makes that result an explicit writer conflict, preserves
its reason and excludes it from automatic writer polling. A structurally
rejected final body also records a conflict before its existing rejection is
re-thrown. Native direct previews suspend immediately on that durable conflict,
preserving text and replay state for explicit resume. No notes, journals,
recovery records or preview caches are removed by this correction.

All 148 targeted tests passed. They cover zero subsequent provider work after
structural rejection, an explicit resume saving a valid final with newer
ordinary text, retention of the original journal-conflict reason, and suspension
of late/queued direct preview work with replay-cursor preservation. Existing
delivery, checked save, native adoption, rename and recovery tests also pass.
The VPS is temporarily paused with its saved enabled setting preserved, native
CLI OFF and Settings CLOSED. Build/full validation runs serially on CPU 0.

The complete 2.34.21 functional receipt retains 68 hashed artifacts and explicitly
leaves the memory problem open. The Windows client was
`8e4eb77e-2e86-4f77-b564-31e511c56243`, with unchanged immutable hashes before
and after its ten-minute read-only sample. Its late five-minute renderer result
was 0.379 cores and 464–868 MiB RSS, improving CPU over 2.34.20 without proving
resolution. The desktop remained locked; no visible Windows or mobile smoke
is claimed. The new conflict-state correction passed its build; full validation
continues serially with the VPS plugin paused.

The source build and complete suite passed 999 JavaScript/TypeScript tests and
11 Python tests on CPU 0. These include the existing transient final-save retry,
stopped-save retry and lost-native-acknowledgement recovery checks. The clean
supported release must repeat validation, followed by actual native behavior
and sustained measurements; this source result is not a memory-resolution claim.

## Reusing unchanged native projections

Immutable 2.34.22 passed its actual native delivery and cleanup checks. The two
retained structurally rejected replies changed from running to conflict, with
the original reasons and body lengths retained. Each received one classification
checkpoint; the other two large journals stayed unchanged. The ten-minute VPS
sample still measured 0.755 renderer cores and 778–1124 MiB RSS in its last
five minutes. The locked Windows client measured 0.229 cores and 432–781 MiB
RSS in the same bounded interval. Neither result proves memory resolution.
The complete functional receipt retains 65 hashed artifacts. The temporary
VPS pause preserved the saved enabled setting, original notes and leaves;
native CLI OFF, Settings CLOSED and the exact global config were restored.

The native view repeatedly reconstructs projections and parses Markdown even
when its actual displayed bytes and local response bodies are unchanged. The
next correction reuses only that view's previously validated projection, after
an exact comparison with its fresh native display. Changed ordinary text,
changed response bodies, damaged boundaries and blocked views still take the
full validation or preserved-conflict path. The general saved-projection helper
continues to validate every supplied document.

The existing Markdown code-range cache has a two-million-character source
budget. This correction raises its budget to eight million characters, keeps
the 32-entry limit and adds numeric hit/parse/bound counters to host status.
Only source strings and independent offset pairs are retained; no syntax tree,
credential or persistent cache is added. UTF-16 source retention is bounded to
about 16 MB, excluding tuple overhead. Uncached or changed source receives a
fresh parse, and callers cannot mutate the cached ranges.

All 100 targeted tests pass. The first new projection test correctly rejected
its damaged end marker, but then attempted disposal without restoring its own
fixture. The corrected test retains the rejection assertions and restores the
valid fixture before disposal; the original failure log is preserved outside
the checkout. Tests also verify 100 unchanged view cycles reuse one projection,
ordinary edits remain fresh, changed replies replace old text, and cache source
and entry bounds evict old documents. Build and full validation run serially
on CPU 0 with the VPS plugin temporarily paused. No language addition is part
of this correction.

The projection/cache correction passed its build and all 1002
JavaScript/TypeScript tests plus 11 Python tests, pinned to CPU 0. Native
sustained measurements remain necessary before any memory-resolution claim.

## Unchanged host projections and offset retention

The complete 2.34.23 native receipt retains 76 hashed artifacts. A real native
view with 67,698 displayed characters returned its exact 26,374-character saved
document 100 times, with zero code-range cache accesses or fresh parses. The
bounded native reply completed and saved exact host hash
`5711badf15dde7b90c54f4da19d081ef674c07d9f3f65e8a2d434dafb486e3aa`;
its ordinary prefix, original leaves and original-note preimages were preserved.
All four large journal counts stayed unchanged. The last five-minute VPS result
was still 0.714 renderer cores and 722–1074 MiB RSS. The locked Windows client
measured 0.218 cores and 470–821 MiB RSS. Memory remains open.

The restored discovery trace showed zero idle display-binding queries, but the
idle profile still attributed 13.21% of samples to host `updateNote`, including
repeated Markdown projection and region parsing. The next correction retains
one validated projection per note only when freshly read saved bytes and all
ordered response identities and bodies match exactly. Changed ordinary bytes,
changed bodies and damaged boundaries use the existing full validation. The
change callback still runs; a different returned document goes through the
normal saved-projection validation. Exact unchanged display output can reuse
the already validated saved projection. This cannot bypass final journal
verification, write intents, current-file checks or native acknowledgement.

The private projection cache retains at most 16 entries and four million
characters across saved/display/body strings, counting body references again
conservatively. Returned ranges are independent copies, and shutdown clears
the cache. Status exposes only numeric counters. The code-range cache now
allows 128 entries within its existing eight-million-character source budget,
and separately caps retained offset pairs at 65,536. Documents beyond either
budget still parse correctly without entering the cache. Syntax trees are
never retained. This addresses the observed 32-entry saturation without an
unbounded offset cache.

All 104 targeted tests pass, including exact unchanged host reuse without any
code-range lookups, independent returned ranges, fresh ordinary edits, damaged
markers, nested generated boundaries, source/entry/range eviction and shutdown.
The initial cache-entry fixture mistakenly gave a 500-character budget that
could hold only one two-marker projection. The corrected fixture separately
tests the two-entry and 500-character bounds; its initial failure log is retained.
The VPS plugin is temporarily paused, with its saved enabled setting preserved;
native CLI OFF, Settings CLOSED and the exact original global config restored.
Build/full validation runs serially on CPU 0. No language additions are included.

The initial projection/cache build and full suite passed 1006
JavaScript/TypeScript tests and 11 Python tests. Before release, review also
found that the main 150 ms device tick refreshes every unchanged native view.
The final correction keeps that device/legacy writer cadence, while spacing
the idle native-view fallback at one second. Stream/lease receives still
refresh immediately; layout changes and file opening schedule one coalesced
microtask refresh. Initial layout readiness still refreshes synchronously.
The callback checks plugin shutdown before touching the native manager.
Within each synchronous device tick, replies sharing a note now reuse one
fresh open-view query. No result is reused across ticks or asynchronous work.
The expanded final source must repeat its build and full validation before
the clean immutable release; no result from the earlier source is substituted.

An initial expanded build rejected a union of two overloaded workspace event
names. The correction registers each typed event separately, without an `any`
cast. The final expanded build, all 162 targeted tests and the complete 1006
JavaScript/TypeScript plus 11 Python suite passed on CPU 0. The supported clean
release must repeat these checks; native behavior and sustained measurements
remain required.

Immutable 2.34.24 passed its clean release checks and native bounded reply
smoke. A hundred unchanged native saved reads caused zero Markdown parses;
51 of 54 host updates in the restored method trace reused a validated
projection. All original leaf states and physical note preimages were
preserved, the synthetic note/tab was removed, CLI was turned off through
native Settings, and the exact global config was restored without overwriting
it. The four large journal counts remain 11,584, 9,955, 5,103 and 6,315.
The complete receipt is `releases/2.34.24/smoke-vps-qlo2.json` under the
external backup root. Its memory result remains open: the last five-minute
VPS sample measured 0.696 renderer cores and 701–1089 MiB RSS; the locked
Windows sample measured 0.266 cores and 440–715 MiB RSS. The root T3 thread
remains an active streaming workload during these measurements. A quiet GUI
does not establish absence of all reply work. Windows visible and mobile
behavior are not claimed.

The 2.34.24 CPU profile still showed repeated command mailbox scans. QLO2
retains 559 command requests and results. Previously, the 250 ms mailbox tick
checked each result separately even when the mailbox namespace was unchanged.
The next correction checks both directory identities with fresh bigint
`lstat` values (device, inode, modification and change timestamps). It skips
the historical result loop only when the identities match the completed
scan before and after that scan. Namespace additions, replacements and
removals invalidate the proof immediately; interrupted scans cannot establish
it. A full audit still runs every 30 seconds using a monotonic clock. Pending
reload acknowledgement callbacks run on every tick, including skipped scans.
Command validation, exact request IDs, atomic results and reload preflight
remain unchanged. No request, result, journal or lease is removed. The cache
contains two directory identity strings and a deadline, without file bodies.
Numeric counters expose actual full/skipped scans for native verification.

All 11 targeted command and client-maintenance tests pass. They verify that
100 unchanged ticks perform no historical result access, while new requests,
deleted failed results, full fallback audits and pending native reload
acknowledgements retain their behavior. The build and complete suite pass:
1008 JavaScript/TypeScript tests and 11 Python tests, serialized on CPU 0.
A clean immutable release and native sustained measurements are still required.

Immutable 2.34.25 passed both clean validation runs (1008 JavaScript/TypeScript
and 11 Python tests), a checked native reload, and one bounded native command
delivery. Its saved bytes match the host final-document hash; the ordinary
prefix and all original leaf/physical-note preimages are preserved. The owned
note/tab was removed and original active Diagnose leaf restored. Native CLI
is off, Settings closed, and the exact global configuration hash retained.
Its complete external receipt is `releases/2.34.25/smoke-vps-qlo2.json`.
The restored native trace measured 57 skipped mailbox scans and one full audit
over 15 seconds. The last five-minute VPS result improved to 0.599 cores and
698–985 MiB RSS. Windows measured 0.248 cores and 510–814 MiB RSS, with a
968 MiB whole-run peak. The memory problem remains open; the locked laptop
has loaded-version and OS evidence, without visible UI or typing proof.

The snapshot-size trace also confirmed duplicate canonical reads: the active
Diagnose thread's device preview and host each fetched the same 424,366-character
snapshot about ten times in 15 seconds. This is a diagnosis, not a change to
stream recovery. The existing polling behavior remains unchanged in the next
correction. The trace records numeric sizes only and restores every owned
method wrapper. The early profile still includes Markdown parsing inside
project image preparation. After the quiet sample, the native image-cache
survey found 16 retained entries: ten ordinary notes consumed 320,437
characters and ten slots, despite needing no Markdown image parsing. Six
candidate entries remain, including a 105,930-character negative result for
image-like syntax that did not produce a real image.

The next correction keeps ordinary reads outside the image cache. A changed
ordinary note first removes its previous candidate entry, so later image
syntax cannot reuse stale data. Candidate text still uses exact-text memoizing
and existing source/count bounds, including negative parse results for syntax
inside code. Signed-resource resolution and renewal continue on each use;
only Markdown syntax is cached. Numeric counters distinguish plain reads,
real parser calls and warm hits. All 16 targeted cache and project-reference
tests pass, including 100 large ordinary reads that do not evict a warm image
entry, ordinary replacement invalidation, bounded negative results, and
changed code/image syntax. Build and the complete 1010 JavaScript/TypeScript
plus 11 Python tests pass on CPU 0. The supported clean release must repeat
validation; actual native behavior and resource measurements remain required.
