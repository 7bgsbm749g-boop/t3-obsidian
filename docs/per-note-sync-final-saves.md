# Per-note Sync readiness for final replies

Automatic final replies pass their exact destination path to the core Sync
readiness check. A current note can finish while an unrelated plugin or file is
still transferring. A note queued behind that transfer still waits for its own
incoming changes. This changes readiness, not Sync's transfer order.

The shortcut uses the private metadata shape inspected in desktop Obsidian
1.14.4. It requires an initialized connection that has finished its initial
metadata replay, a recent incoming message, and completion of the existing
notification queue. It does not append work to either native queue or request
version history. A new notification tail immediately invalidates readiness.

No pending remote update, deletion, ancestor change, path retry, or active
transfer may affect the destination. Its last recorded synced hash must match
the applied remote file version. The path, file kind, rename state, and current
native file statistics must agree with those records. A cached current hash or
file timestamp alone is insufficient. The last synced baseline may match while
ordinary local changes remain unsent; those edits stay in the checked local
note projection.

The check runs before preparation and at the compare-and-set write boundary.
The existing native editor fences, current-note reads, pane agreement, file
identity checks, atomic write and disk verification remain in place. Renaming
the destination while a write is held also invalidates its old-path guard.

Unsupported internals and missing retained baselines keep the previous
whole-vault `synced` check. Known pending note updates, unprocessed notifications,
or an unhealthy connection cannot use the shortcut. Other sync transports and
disabled core Sync keep their existing checked local saves. Explicit Stop
retains its separate user-action save behavior.

This establishes the latest received server state, not a global writer lock.
It cannot detect unsent changes on an offline device or prevent another device
from making a later edit. Identical final saves still use normal Sync equality
checks; differing notes still use its configured conflict policy.

## Verification scope

Tests cover unrelated transfers, pending note and ancestor updates, notification
decoding races, silent/open sockets, missing baselines, unsupported versions,
rename races and the final mutation guard. The native fixture is prepared with
`node scripts/build-native-response-lab.mjs PRIVATE_DIRECTORY --per-note-sync`.
Its private `ACCESS.json` supplies read-only access to an existing synthetic T3
response; credentials stay outside the vault. It imports the real persisted
reply, exercises native editor/file IO with controlled Sync metadata, records
screenshots outside the vault, then deletes its notes and closes its own client.
It creates no T3 threads and never changes the retained source thread.

Controlled Sync metadata is not a live desktop core Sync connection. Official
Headless Sync propagation and native mobile behavior remain separate evidence
categories. No native iPhone or Android claim follows from this desktop fixture.
