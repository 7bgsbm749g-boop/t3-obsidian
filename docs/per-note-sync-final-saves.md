# Sync-independent final replies

Final replies do not wait for whole-vault or per-note Sync readiness. Paused,
disconnected, transferring and unsupported Sync engines all use the same checked
local save. Sync status remains diagnostic evidence, not permission to write.
The compatibility `syncReady` adapter hint is ignored.

The native note IO reads current disk text, reconciles compatible ordinary
editor edits and requires agreement across source panes. It checks file
identity, pane membership, exact response bindings and current disk bytes again
inside Obsidian's atomic `vault.process` callback. It then verifies the saved
bytes before reporting success. A changed note causes a checked refusal; it
never forces an old prepared document over newer local text. Stop retains the
same native write protection for its frozen reply.

Incoming compatible changes continue through the existing native three-way
merge. Overlapping changes retain the conflicting versions and fence unsafe
autosaves. These are local protections: they cannot detect unsent edits on an
offline device or guarantee that Sync will never later deliver a conflicting
remote edit. No distributed writer lock is claimed.

Regression checks exercise completion during busy Sync, imported closed notes,
actual disk changes at the atomic boundary, pane membership changes, renames,
unsaved typing, late peer receipts, checked note proposals and explicit Stop.
The native per-note Sync fixture records a completed save while controlled Sync
metadata is still busy, followed by compatible remote text and local typing.
Controlled desktop metadata is separate from real Headless Sync propagation
and from native iPhone behavior.
