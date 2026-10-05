# Stream credential recovery and QLO2 memory investigation

## Authentication cause and delivered fix

The affected authentication is the VPS Obsidian response host's automatic,
five-minute local T3 API credential. It is separate from the OpenAI login and
the laptop's managed account pairing. The stop helper borrowed the host's raw
shared access object and closed it after interrupting a turn. That revoked the
credential used by other responses, while the host cached it for three minutes.
Two retained stop times align with the early revocations. In the original
55-second incident, T3 already had assistant text about 7.6 seconds after send;
the response host adopted it only after its cached credential was replaced.

Commit `33fee81` gives the cache ownership of credentials and returns borrowed
access with non-revoking cleanup. One shared renewal follows an HTTP 401;
concurrent safe reads retry once. Dispatch is never replayed. Expiry respects the
actual credential lifetime. Repeated rejection uses a bounded cooldown. Local
auth audit records reasons and caller frames, without credentials or message
content, in two bounded 256 KiB files outside the vault.

QLO2 release **2.31.32** passed all 779 TypeScript and 11 Python tests. Installation
preserved device-local plugin settings and completed a fresh official Sync scan.
The laptop confirmed loading the release with a new client instance. The VPS
guarded reload initially refused a stale native projection; a native plugin
disable/enable cycle loaded the release. After that process later exited, the
existing QLO2 profile was reopened and confirmed loaded 2.31.32 again.

Live evidence verifies eight concurrent reads recovered from revoking an isolated
test credential in **1,575 ms**, with exactly one renewal. A real synthetic turn
was interrupted, saved and cleaned up. Its shared host credential was only
borrow-released at 18:47:32.827 UTC; it was revoked at normal cache expiry at
18:48:27.597 UTC. A subsequent real response completed at 18:47:42.458 UTC using
the still-valid host access. Each of the four synthetic sends has one exact
canonical user-message row. Two T3 threads were used. Both initially completed
60-second responses and the later interrupt/post-stop responses are retained.

The final answer was visibly present in a real QLO2 editor. All four owned
temporary notes were retained outside the vault and removed through Obsidian's
native vault API. Only their four panes were closed. The original active pane
was restored and the original 19 Markdown panes retained. General app settings
were byte-identical. Native plugin re-enabling reordered the enabled-plugin list
but preserved its membership; the release installation preserved data.json bytes.
Synthetic sends subsequently added their normal plugin tracking metadata.

Original command `681e6bc2-f8a3-4e6f-b5e0-c38a35d905cd` was never retried. The
original orphan `e25b4b29-1ba8-5179-bcdd-ad63854b6fb5` and current incident response
`6de3ba50-b5ec-5963-a6d4-1db7176bb004` were not edited or stopped. This release does
not repair orphan-response targeting or chooser labels. No purchase was made.
The observed API recovery is not an end-to-end laptop latency benchmark; native
mobile rendering was not tested.

## What contributed to the RAM pressure

At the stalled-client observation, QLO2's renderer occupied 2,089,408 KiB RSS and
its main process 1,430,120 KiB. The VPS had only about 679 MiB available and all
4 GiB of swap occupied; memory pressure stalled work for roughly half the time.
The original process exited before a retained-heap capture, so these observations
do not establish an OOM kill or prove a permanent leak.

A five-second allocation/CPU sample of the reopened real QLO2 client identifies
a substantial continuing workload in the subscription/display service:

- Its durable event state is about 6.5 MB; about 6.2 MB is 22 cached thread
  histories. There are 17 enabled subscriptions and two active display monitors.
- `EventSubscriptions.serialize` in `event-subscriptions.ts:100` deep-copies the
  entire state for every serialized action, including monitor callbacks and ticks.
- `event-subscriptions.ts:282` saves that entire state for each accepted monitor
  update. The display loop also saves it each tick, including unchanged displays.
  `event-host-desktop.ts:31` serializes the full state to JSON each time.
- The sample estimates **1,114,756,340 bytes of allocations in five seconds**,
  including about 210 MB in the rollback clone, about 143 MB in state saving,
  and substantial HTTP decoding, file reads and response-binding scans. CPU self
  samples are led by the same clone and save functions.
- Used JavaScript heap fell from 315.8 MB to 129.8 MB during collection in the
  sample. Allocation volume is churn, not an additional 1.1 GB retained forever.
  The fresh renderer's RSS also fluctuated downward between observations.

This gives a concrete contributor to CPU, heap growth and swap pressure. The old
peak cannot be attributed exclusively to it without the old process's heap.
The auth audit has only a few small events and is not generating the measured
allocation volume. Increasing VPS capacity would not remove this workload.

Recommended follow-up: coalesce monitor updates, avoid full rollback clones for
unchanged ticks, save only dirty state, share/coalesce thread reads, and bound or
separate cached histories for inactive targets while preserving durable history
and delivery recovery. The RAM investigation is read-only; no subscription,
display or targeting implementation/settings were changed.

## Real client control route and retained handoff

Evidence root:
`/home/ubuntu/backups/send-to-t3-code/auth-recovery-20261005T135736Z`.

The plugin's supported bridge remains:
`python3 scripts/obsidian-command.py --vault /home/ubuntu/vaults/QLO2 --request-id UUID client-status`.
Fresh status requires a new UUID. Failed/pending mutations retain their original
UUID and exact arguments. Do not retry the incident's failed command.

For native GUI inspection/control I used `vps_computer` Cua MCP on its existing
Unix socket `~/.cache/cua-driver/cua-driver.sock`. The final real QLO2 main target
is PID **2440332**, X11 window **6291459**; refresh `list_windows` before use.
The earlier settings window was **6291482**. AT-SPI exposed only the top-level
window, so foreground pixel delivery was verified from fresh native screenshots.
Background clicks on this Electron surface were observed no-ops. No standalone
browser, external CDP listener, profile replacement, or unrestricted Cua JS mode
was used. T3's browser preview explicitly reported unavailable before fallback.

I temporarily enabled **Settings → General → Advanced → Command line interface**
and skipped PATH registration. It was restored **off** after inspection. Once
enabled, the supported native executable is:

```text
/opt/Obsidian/obsidian vault=QLO2 dev:dom selector=CSS_SELECTOR
/opt/Obsidian/obsidian vault=QLO2 dev:screenshot path=ABSOLUTE_EVIDENCE_PATH
/opt/Obsidian/obsidian vault=QLO2 eval code=BOUNDED_NATIVE_SDK_EXPRESSION
```

Use the retained `native-obsidian-cli.py` transport for asynchronous commands:
it keeps stdin open until the native reply arrives. Early stdin EOF otherwise
closes Obsidian's IPC connection before some asynchronous results are returned.
The CLI socket is `/run/user/1000/.obsidian-cli.sock`, not a credential-bearing
HTTP/CDP endpoint. Runtime profiling used the CLI's own renderer and
`window.electron.remote.getCurrentWebContents().debugger.sendCommand`, scoped to
the verified QLO2 path and webContents 1. The debugger was detached afterward.

Retained scripts:

- `live-api-recovery.mjs`: isolated immutable-runtime credential recovery probe.
- `cancel-delivery-smoke.py` and `stop-smoke.mts`: real native delivery/interruption.
- `native-obsidian-cli.py`: reliable supported native QLO2 CLI transport.
- `obsidian-runtime-probe.py`: five-second allocation/CPU sample without heap objects.
- `cleanup-smoke.py`: exact owned-note cleanup and original-pane restoration.

Key evidence includes `live-api-recovery.json`, `live-stop-auth-evidence.json`,
`bounded-delivery-once-evidence.json`, `post-stop-client-visible.png`,
`final-client-status.json`, `cleanup-and-pane-restore.json`,
`runtime-profile-summary.json`, `ram-allocation-stacks.json` and
`ram-state-breakdown.json`. Immutable release/smoke receipts live under
`/home/ubuntu/backups/send-to-t3-code/releases/2.31.32/`.
