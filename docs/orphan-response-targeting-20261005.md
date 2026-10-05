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

Implementation and real-client release verification are recorded separately below
when complete. Native mobile behavior requires additional verification.
