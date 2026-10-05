# Response authority liveness and safe historical catch-up

On October 5, the purchase response stopped at the checkpoint saved at
00:18:03.942 UTC (T3 sequence 194039). All authority replies stopped by
00:18:05.376; later checkpoints and both registration commands remained
unanswered. The command bridge still answered fresh `client-status`, the
response and command locks renewed, and native projection remained advertised.
A supported read-only `response-status` also succeeded, narrowing away from an
opening or shutdown drain as the leading live state.

The separate read-only diagnosis and patch investigation agree that one stalled
inline authority explains both symptoms. A replay of the retained inputs using
an in-memory write overlay acknowledged both registrations in 1,198 ms. The
saved inputs are valid. Historical diagnostics were disabled, and no verified
runtime inspection route was available. The initiating promise, operation and
stack remain unknown; a stuck mutation or another serialized task is still
possible. A read timeout is a recovery mechanism, not the established incident
trigger.

The patch bounds only authority reads and enumeration to two seconds and cancels
them when the host stops. Abandoned results cannot resume the old scan. Writes
and removals retain their full promises and serialization under the existing
host lock; uncertain mutations are never abandoned to admit another owner.
Fresh `client-status` now reports bounded operation metadata (operation, private
storage path, elapsed time, timeout count) and authority/opening state. It
includes no record contents, prompt, answer, note body or connection credentials,
and creates no diagnostic logs or background publication.

Exact-history recovery now retains the last applied checkpoint's session and
latest turn. New checkpoints can replay from that cursor. Older checkpoints
without this evidence still replay their original start, rather than invent an
active session. The initial recovery checkpoint and gap cursor are durably saved
before a canonical checkpoint advance or an interruptible replay. They survive
later snapshot replacements. Only actual protocol events augment historical bindings.
An oversized snapshot-only replay explicitly remains waiting, preserves the
response and never dispatches a prompt or borrows an unrelated turn.
An event replay that reaches synchronization without the required lifecycle also
remains waiting. A snapshot-head cursor retained by the initial 2.31.28 delivery
is safely rewound from the exact original start ID when its saved session belongs
to an unrelated turn. This restores the replay range without inventing evidence.

The original incident's available history (817 thread rows at 00:29:38) could
recover the original turn plus its two exact async answers, one steering that
turn and one starting a continuation. The diagnosis's synthetic reconstruction
recovers all six original and two continuation assistant messages and excludes
the later complaint. This is a reconstruction from retained metadata, not a
historical network or editor capture.

By the later authenticated probe, that range exceeded the server's 1,000-event
replay limit. Its replacement snapshot has only an unrelated latest turn, null
answer turn IDs and no old completion checkpoints for this non-Git project.
Transcript pagination does not restore those associations. The server exposes
no bounded historical event pages or per-turn lifecycle read through the current
supported API. This later limit did not cause the original freeze. Restoring the
host alone cannot prove completion of that original purchase response: it remains
an explicit upstream history prerequisite. No server changes or private database
recovery are included.

Regression coverage exercises the packaged host's lost read, acknowledgement of
the same immutable registration, exact replay, cancellation before ownership
reacquisition, late-result rejection, and retained slow mutation promises. Existing
command delivery tests retain one dispatch across retry/restart. Historical
recovery tests preserve exact bindings, session evidence, gap cursors, checked
completion and exclusion of unrelated work; snapshot fallback remains waiting.

Evidence is outside every vault:

- `/home/ubuntu/backups/send-to-t3-code/investigations/2026-10-05-newgame-stale-stream`
  contains the read-only baseline, incident timeline, verified journal metadata,
  authenticated replay limits and synthetic history reconstructions.
- `/home/ubuntu/backups/send-to-t3-code/investigations/2026-10-05-response-registration`
  contains preserved failed command bytes in private storage, allowlisted
  snapshots, read-only response status, regression logs and release/live evidence.

The failed original command is never retried by this job. Its queued registration
may be acknowledged after recovery, but registration itself does not dispatch
its saved prompt. Preserve its immutable failure result and the purchase note.
No purchase, KeePass unlock or other purchase-workflow action is authorized here.
Native mobile and desktop core Sync coverage remain separate from the VPS's
real desktop and official Headless Sync validation.
