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
