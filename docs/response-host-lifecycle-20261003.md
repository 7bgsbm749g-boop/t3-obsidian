# Response host registration and restart recovery

At 23:03 UTC on October 3, mobile clients retained three native response
registrations without host acknowledgements. The host had stopped answering
mailbox traffic around 22:31, while its lock continued renewing. The queued
registrations and both affected notes were backed up before recovery. A
read-only authority replay using an in-memory write overlay answered those
same requests in 514 ms. Normal QLO2 app quit/reopen recovered all three
registrations with unchanged binding, thread and message identities.

Registration recovery does not dispatch a saved prompt. The proposed T3
thread `4a7282a0-401b-5809-b7a7-e84598ecdead` was still absent after host
recovery. Saved requests belong to their originating device; use its Retry
control with the original request rather than reconstructing a send from
current note text. Two separate failed sends targeted `3 problems.md`; both
remain preserved. Do not blindly retry both or remove one without reviewing
the intended request.

The exact trigger of the initial host stall was not captured. Console
errors and renewing lock timestamps do not establish lock compromise,
renderer reload, Sync, or phone keyboard handling as that trigger. Isolated
real-app reload experiments, including a pending renderer operation, did
not reproduce the initial stall; their evidence is retained.

The investigation did establish three recovery defects:

- Lock compromise disposes the desktop response host. `refreshInlineHost`
  previously kept the disposed instance because its vault key was unchanged,
  leaving subsequent registrations unanswered. Refresh now waits for that
  host's shutdown and reacquires ownership through the existing lock API.
- The command bridge attempted ownership only once at startup. During the
  real app reopen, its previous lock was still fresh, so it remained offline
  even after that lock expired. It now retries from the desktop coordination
  interval and replaces stopped instances, with one opening attempt at a time.
- A connection-close exception could skip response-lock release. Shutdown
  now exposes one shared completion promise, stops writers first, drains work,
  settles every cached connection close independently, and releases ownership
  in `finally`. It does not bypass an active owner's lock or alter lease state.

`tests/desktop-host-lifecycle.test.ts` runs the packaged desktop code with real
private storage. It reproduces lock compromise in a temporary test vault,
then requires acknowledgement of the same original registration. The old
bundle fails with the user's exact registration-timeout message. Tests also
cover a refused startup lock followed by recovery of one retained command,
single execution across restart, and failed connection cleanup. The optional
`T3_HOST_LIFECYCLE_BUNDLE` test input permits comparison with an immutable old
bundle without changing source or installations.

Initial records, replay, before/after app evidence and baseline failures are
under `/home/ubuntu/backups/send-to-t3-code/response-host-registration-20261003`.
Delivery requires the ordinary newer immutable QLO2 release, preserved plugin
settings, fresh Sync scan, native reload and a bounded real saved reply.
Neither desktop recovery nor those delivery checks establish native iPhone
tap/keyboard coverage or the historical old-path resurrection mechanism.
