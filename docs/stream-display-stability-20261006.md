# Streaming display stability and tool history

Implemented after the read-only investigation of the flicker reported in the
T3 files in vault thread. The investigation replay is retained at
`/home/ubuntu/backups/send-to-t3-code/investigations/20261006-stream-flicker/diagnosis.json`.
It found 111 assistant deltas with a median length of four characters and a peak
of 36 changed full-body renders per second. Text reconstruction matched the
canonical assistant messages; native callout replacement was the display problem.

## Changes

- The direct device consumes every event and advances its replay cursor at once,
  but formats and publishes its display at 80 ms intervals. The first bound
  display and terminal message/session updates are immediate. Pending work is
  cancelled on suspension, Stop, completion takeover, and disposal.
- Active native callouts reconcile ordinary Markdown nodes before paint. Their
  completed text and keyed tool details retain identity and open state. Separate
  surfaces prevent hidden Live Preview copies from displacing Reading view.
  Native links, buttons, embeds and custom renderers use the incoming render
  children. Active fold choices apply without a close/reopen animation, including
  content visibility and arrow state. Completed history uses the existing native
  closed default and leaves the final answer outside the fold.
- The unfinished Markdown block stays literal until a blank line outside a code
  fence, or until the message is sealed. This avoids repeated table, heading and
  code-widget transitions as syntax arrives. Completed blocks and final replies
  use the normal formatter. The displayed tail is escaped and has no active HTML.
- Tool lifecycle records merge by exact ID, retain concurrent tools and terminal
  evidence, and accept sparse results without losing command metadata. Labels
  unwrap common shell launchers, such as `/bin/bash -lc 'npm test …'` →
  **Running npm**. Keep and Collapse history retain expandable command, directory,
  files, output, duration and exit-code details when T3 supplies them. Output is
  escaped and bounded to 20,000 display characters. Newlines use HTML entities so
  raw tool output cannot break out of the quoted row. Stop seals active rows.
- Device previews still do not acquire writer leases, import files, or save
  generated text. Durable host projection and checked final adoption remain the
  authority for saved notes. The status remains **Working**.

## Verification

The reusable real-editor fixture is `validation/dense-stream-lab.ts`, prepared
with `scripts/build-native-response-lab.mjs NEW_PRIVATE_DIRECTORY --dense`.
It runs in an isolated, unsynced Obsidian vault with synthetic events. It is not a
substitute for a QLO2 release smoke test.

Reviewed native evidence:
`/home/ubuntu/backups/send-to-t3-code/stream-fix-20261006/native-dense-6/RESULT.json`.
All 19 checks passed. Seventy-seven three-character deltas produced 20 display
updates across the complete test (including tool and terminal updates). Across
43 sampled animation frames in two panes, missing, closed and replaced history
counts were all zero. Completed paragraph identity and expanded tool detail
identity were retained. Live Preview, Reading view, Source mode, escaped output,
concurrent tools, user collapse visibility/arrow state, ordinary editor selection,
editing, undo, native command copying, clean disk projection, delayed final
arrival and checked final adoption were verified. Screenshots and DOM captures
are retained beside the result. The clipboard was restored after the copy test.

The first native trial exposed a multiline HTML row failure and the hidden
surface risk. Both are covered by the retained checks. These trial
artifacts remain outside the vault and were not released.

Build and full suite: 888 JavaScript tests and 11 Python tests. The display-clock
unit test sends 100 dense deltas, checks the immediate replay cursor, checks the
full accumulated text at bounded intervals, and checks urgent terminal flushing.
Tool tests cover sparse/out-of-order lifecycles, concurrent identity, exact-turn
isolation, shell labels, details, escaped multiline output and final placement.

The supported release receipt and QLO2 live-delivery evidence are recorded under
`/home/ubuntu/backups/send-to-t3-code/releases/` and
`/home/ubuntu/backups/send-to-t3-code/stream-fix-20261006/` respectively.

QLO2 release **2.33.7** received a fresh successful Headless Sync scan and a
supported client reload. The new client instance reported loaded version 2.33.7.
Two bounded real deliveries completed and saved their final replies. The second
used a full-width Live Preview editor: across **2,413 sampled animation frames**,
missing, closed and replaced active callout counts were zero. The expanded tool
retained node identity and open state through `inProgress` → `completed`, displayed
**Running python3** → **Ran python3**, and retained its exact command and output.
The completed fold closed normally, with the final reply visible below it.
`qlo2-live-metrics.json`, screenshots, saved synthetic note copies, lease records,
reload acknowledgement and client status are retained in the dated evidence root.
The first delivery's diagnostic pane obscured its live content; no live frame
claim relies on that run. Both temporary notes were removed through the real
client after completion, the previous note was restored, and native CLI access
was returned to its original disabled setting. The final host status was idle,
with zero pending operations and zero timeouts.

## Limits

This verifies native Linux desktop editor behavior, with the production release
transport using official Headless Sync. It does not establish desktop core Sync
engine behavior or native Android/iPhone behavior. No mobile client was tested.
Tool rows show fields present in T3's canonical events; they do not reproduce
all of T3 Code's specialized application, website and artifact widgets. The
20,000-character limit is a display limit; full output remains in T3 Code.
