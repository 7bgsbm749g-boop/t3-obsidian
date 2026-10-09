# Recovery maintenance verification, 2.36.4

The reviewed source commit is `cf98bc1a7317c0b0d38f9227ba33583f03bf6670`.
Release 2.36.4 retains the recovery format and delivery/ownership intervals.
Maintenance verifies heads and referenced file identities without reconstructing
unchanged documents. Publications and exact acknowledgements queue bounded
cleanup; startup recovery and a slow safety scan resume interrupted work.

The build and full suite passed 1,148 TypeScript tests and 11 Python tests, both
before packaging and through the release command. Thirteen focused maintenance
tests cover copies over cache limits, mutable isolation, corruption, same-size
replacement, rollback, missing files, rename retention, interrupted cleanup,
bounded visits, changed publication, cancellation and delivery priority. Existing
tests cover save compare-and-set, interrupted publication and late acknowledgements.

## Allocation measurements

Two controlled V8 allocation profiles ran thirty maintenance calls at 500 ms
intervals for 15 seconds. They used forty synthetic records with 335,000 original
characters each, exceeding the hydrated-state entry and character budgets. Setup
and publication were outside sampling. The baseline source hash matches the
preceding released source; the candidate hash matches the reviewed implementation.
The sampling interval was 524,288 bytes and included objects collected by GC.

| Controlled maintenance | 2.36.3 source | 2.36.4 source |
| --- | ---: | ---: |
| Sampled allocation bytes | 172,107,912 | 4,194,808 |
| Full-state copies | 240 | 0 |
| Original characters copied | 80,400,000 | 0 |
| Elapsed milliseconds | 15,000.44 | 14,999.96 |

The sampled reduction was **97.6%**. These measurements used isolated Node
journals with synthetic data. They establish maintenance cost, not total renderer
memory or native mobile behavior. The cache-limit regression also checks cold
heads beyond the metadata cache, with no full-state hydration or blob-string reads.

Separate native Electron profiles captured the real QLO2 renderer for 15 seconds
on each version with the same allocation sampling interval. Total sampled
renderer allocations were 1,657,196,736 bytes before and 1,939,188,544 bytes after.
The total did not decrease in these samples. The profiles still show substantial
display, save, checkpoint and read costs outside unchanged recovery maintenance.
The whole-renderer result must not be represented as a 97.6% improvement.

The native renderer interval lasted 600.002 seconds with 62 numeric samples.
RSS ranged from 859.4 to 1,527.7 MB, starting at 1,378.6 MB and ending at
1,413.4 MB. JavaScript heap use ranged from 212.9 to 878.4 MB. These are decimal
megabytes. Maintenance reported no integrity failures. RSS still varies widely;
this interval does not establish a 464 MB target or resolve every source of
renderer allocation. The full interval is retained in immutable smoke evidence.

## Native delivery and preservation

The supported release command installed immutable bytes into the development
vault and QLO2, preserving each installation's `data.json` during installation.
Its fresh one-shot Sync scan required `Fully synced`, and the continuous QLO2
service restarted. The archive SHA-256 is
`dbf56db56a53678d76b301e116dcec7bc0d43678824745ca362a446a18dbd9a2`.

The guarded QLO2 reload changed client instance
`e41737f0-c3b9-4144-9087-1b87aea012c4` to
`20a3c5a9-6c3e-471e-8754-824e8f9fecd0`, loaded as 2.36.4.
One bounded send used the existing test thread
`0d7d3a28-b26a-5887-8b69-30474944eee5`. Its second run completed with exactly
`MEMORY_2364_OK`. Binding `ade1ce3e-4861-5828-aeec-c422cf012fad` reached verified
save and exact commit/hash acknowledgements. The actual open editor equaled the
saved file. A native screenshot and proof hashes are retained outside the vault.

The owned temporary note was deleted through the native vault API. The original
note, buffer, view mode and active path were restored. All 215 pre-existing
unresolved recovery heads remained byte-identical, including their original and
conflict identities. Normal note-history changes and concurrent client history
updates were retained instead of replacing settings with an older snapshot.

## Independent desktop Sync

The separate Sync Test A and B desktop profiles used the dedicated synthetic
remote vault and official Headless Sync. B completed and saved while its Sync
service was stopped. Its matching acknowledged full completion journal retired.
A's disk remained on the original until Sync resumed. A then adopted the exact
saved response and local ordinary edit in its open editor without reloading.
Both reading and source views were checked. The unique synthetic note was removed
through Sync; fixture configuration and previous service states were restored.

This verifies desktop editors and real remote-file propagation. It does not
verify the desktop built-in Sync engine, native iPhone or native Android.

Private raw profiles, counters, preservation hashes, screenshots and test logs
are retained under
`/home/ubuntu/backups/send-to-t3-code/recovery-memory-20261009T1612Z/`.
The final immutable receipt is
`/home/ubuntu/backups/send-to-t3-code/releases/2.36.4/smoke-vps-qlo2.json`.
