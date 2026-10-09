# Response storage lifecycle

Recovery bytes remain until a save is verified and acknowledged. Cleanup never
uses elapsed time to decide that a conflict is resolved. Active responses,
unresolved conflicts, pending saves, staged edits and renames keep their evidence.

## Host recovery

`CurrentGenerationJournal` keeps one authenticated current head per response.
Large identical strings share checksum-addressed objects within that response.
The head keeps at most 64 small event entries. Publication syncs objects, replaces
and syncs the head atomically, verifies readback, then records an authenticated
publication anchor. Stale revisions, changed objects, missing published heads
and authenticated rollback are rejected.

Recovery maintenance verifies small heads separately from full document reads.
Unchanged records make no full-state copies. Changed checksum objects are hashed
in 64 KiB buffers; fresh file identities, head authentication and publication
anchors remain required. Public reads receive isolated mutable states. Small
verified heads and hydrated states have separate entry and character budgets;
scans beyond either limit do not evict every warm record.

Publication, matched acknowledgements, conflict settlement and removal queue
cleanup. Startup discovers unfinished work. A 30-second safety scan resumes in
small directory slices. Each maintenance call selects at most four records and
each cleanup slice visits at most 512 files, with at most eight retained cleanup
cursors. Calls coalesce, active delivery queues take priority, and shutdown
cancels cleanup and closes cursors. Failed integrity checks retain evidence and
retry slowly. If removal publishes a retired state, collection uses its verified
new head. Delivery and ownership intervals are unchanged.

Migration verifies the entire legacy hash chain and publishes its exact latest
state without changing the revision or authorizing a note write. Old snapshots
are deleted only after verified publication. Bounded maintenance resumes
interrupted deletion. Corrupt journals remain untouched. Storage stays under
`~/backups/send-to-t3-code/coordinated-journals/`, outside registered vaults.

Matching verified commits and actual device acknowledgements permit removal of
settled conflict copies and obsolete streaming checkpoints. Original and proof
bytes remain useful for explicit repair, completed-history controls and
generated-output filtering in subscriptions. They have no arbitrary deadline.
Explicit removal retains the identity and original checksum, while releasing
obsolete recovery documents. Unreferenced objects and abandoned temporary files
are collected under serialized response maintenance.

## Private operational store

The desktop host moves `inline/v1`, `events/v1` and `commands/v1` out of the vault
to `~/.t3/send-to-t3-code/vaults/VAULT_PATH_HASH/`. Virtual relative paths and
request identities stay unchanged. Only the small checked
`<configDir>/t3-code/storage-route.json` identifies the external root.
Authenticated clients and the command CLI follow this route, including
connections opened before migration. Notes still use the chosen Sync service.

Migration holds the original writer locks. Same-volume moves are atomic.
Cross-volume migration freezes the original, copies and syncs files, compares
SHA-256 checksums, publishes the route, then removes the verified frozen copy.
Failed copies restore the original; interrupted copies resume. Conflicting
stores, symlinks, invalid routes and storage inside a registered vault fail
closed. Pending commands, grants, proofs and subscriptions move with the store.
Reload every participating client after installing this release: old clients
cannot interpret the new route. Do not downgrade a migrated host or manually
move its records back into a vault.

New ownership replies contain a small current-record reference. Clients check
the ID and epoch/revision and fetch the current authority record. Old full
replies remain supported. Maintenance scans at most 2,048 replies per slice with
eight workers, separately from sends. Replies stay for at least one minute;
pending commands and malformed files are preserved. Small agent-command
receipts remain replay fences.

## Device completion and native conflicts

Full IndexedDB completion journals retire in one transaction only when their
verified commit matches the host acknowledgement, permanent grant, immutable
request and stable sender. Small identities remain to prevent duplicate
insertion or replacement of later edits/deletion. Recent full proofs have limits
of 32 records, eight million serialized characters and 30 days. Proof expiry
does not expire replay identities. A resurrected old response anchor requires
checked host evidence and cannot trigger a save from an expired local document.

Native conflicts retain one full record per unresolved pane. Repeated updates
replace that record. The record is removed only after the chosen ordinary text
reaches disk; failed saves retain it. Resolution history keeps at most 64 small
checksum receipts. Existing unresolved legacy copies remain preserved.

## Verification

Tests cover migration, damaged chains/objects, interrupted publication/copy,
rollback, replay protection, retention bounds, pending commands, explicit removal
and failed conflict saves. The existing suite checks Stop, reload, rename,
concurrent destinations, staged edits, subscriptions and permanent final grants.
Full build/tests and real QLO2 smoke remain required release gates.

Focused maintenance tests cover zero document copies over both cache limits,
mutable read isolation, same-size replacement, missing files, authenticated
rollback, pending rename retention, restarted cleanup, bounded file visits,
changed publication during cleanup, cancellation and delivery priority. Numeric
journal counters in desktop status expose verification, hydration, copy and
cleanup counts without document contents.

The independent desktop Sync fixture checks local completion and retirement
while sender Sync is stopped, then exact file propagation and visible receiving
editor adoption without reload. It uses official Headless Sync. Desktop core
Sync and native iPhone/Android remain separate coverage limits. All evidence
stays outside vaults.
