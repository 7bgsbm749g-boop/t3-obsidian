# Checked destinations for response asks and note sends

The original registration timeout left a response anchor whose recovered lease
targets a proposed T3 thread that was never created. Selection asks treated its
Working header as evidence of a running conversation, while whole-note sends
used the note's different, valid remembered thread. The resulting HTTP 404
included retry advice even when that action had not saved a request.

The chooser now reads the exact selected thread before enabling its default
action. Selection asks retain their captured response identity; whole-note
sends retain their remembered thread identity. Both use the same authenticated
activity labels, title and short thread ID. Missing, archived, inaccessible or
wrong-project targets disable the default action and leave explicit New thread
and Existing thread choices available. A thread running a different provider
turn cannot extend the old response: exact retained turn bindings are required.
Idle responses continue the same thread with a fresh reply rather than attaching
input to a completed block. Existing-thread choices bypass automatic response
targeting. No alternate destination is selected silently.

Validation is read-only. Closing or changing the chooser while a check is pending
cancels that submission. Sending rechecks response ownership and thread existence
before persisting a new request. Transport HTTP errors no longer prescribe a
saved-request retry; the delivery layer supplies advice based on actual durable
request state. Original failed prompts and orphan records are never replayed,
deleted or rewritten by this change.

Regression coverage includes an accepted but undispatched response and a different
remembered thread, explicit existing-thread dispatch, selection/whole-note labels,
changed editor projections, changed provider turns, disappeared targets, pending
validation cancellation, and preservation of selection text and immutable orphan
records. The original purchase's unavailable exact answer history remains a
separate limitation; this change does not expand the server recovery API.

This work follows the completed 2.31.32 credential-ownership repair. That release
prevented Stop from revoking shared access and added coordinated safe-read renewal;
it did not fix destination selection. Its separate memory investigation confirmed
an OOM and substantial subscription-state allocation churn. No RAM optimization,
subscription change or capacity purchase is included here. See
[the preceding handoff](auth-recovery-and-memory-20261005.md).

## QLO2 2.31.33 delivery

Implementation commit: `f4eacce554a6273723e2aef6ba27f2abb112f8d5`. Build and the
complete suite passed **786 TypeScript and 11 Python tests**. The strictly newer
immutable release installed into both vaults with byte-identical installation
settings and a fresh successful official Sync scan. Guarded `app:reload` changed
the VPS client instance from `cea41ccf-6f93-45f7-9286-35a8c4992585` to
`4ae0b225-bf68-41aa-b638-7a03f75beb8c`, reporting loadedVersion 2.31.33.

The real QLO2 smoke used one owned synthetic note and an in-memory synthetic
response fixture; no production lease was injected. Its nonexistent target
returned authenticated 404, and the actual chooser disabled Thread unavailable
with an explicit missing-thread explanation. The whole-note chooser independently
showed Continue thread with the real remembered conversation's title and short ID.
Foreground Cua pixels selected Existing thread and the exact owned test thread.
That selection created a fresh response rather than steering the orphan.

Thread `88e6aac1-2260-53f4-a27d-5ea12171818d` has exactly two canonical source
messages: one seed and one explicit selection. Its delivery binding
`6584f36f-01e3-4362-b488-3f370ef18810` reached complete, finalSaved and
cleanupComplete, with the expected final token visible in the real editing pane.
The seed acknowledgement arrived after the caller's 35-second timeout; its saved
result was inspected and no request was resent. This verifies delivery identity
and completion, not a latency benchmark.

The synthetic note and fixture were removed. All 19 original pane IDs and the
original active pane were restored. The temporarily enabled supported native
Obsidian CLI was restored off. The purchase note, general settings, enabled-plugin
list, original failed request/result and original orphan's immutable request match
their pre-release hashes. Normal synthetic-send tracking metadata was added by the
product. The original orphan's header and anchors remain; no prompt was replayed.

Completed immutable receipt:
`/home/ubuntu/backups/send-to-t3-code/releases/2.31.33/smoke-vps-qlo2.json`.
Sanitized evidence and native screenshots:
`/home/ubuntu/backups/send-to-t3-code/orphan-targeting-20261005/`.
Laptop reload transport remained pending. Native iPhone/Android rendering was not
tested. No purchase action, server history API expansion or RAM optimization was
performed.
