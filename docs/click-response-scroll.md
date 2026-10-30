# Explicit response follow control

The running response block offers a double-down-arrow button in Live Preview
and Reading. Each note in a pane starts with follow off. A trusted click, Enter
or Space on this button enables follow for its exact active fold identity. Text clicks,
synthetic clicks, cursor proximity and arriving stream updates do not enable it.
Source mode has no rendered block button; a mode change cancels follow.

Activation immediately starts a 420 ms trip, using the rendered callout's
bottom edge and the active pane's own scroller. A visible status bar which
overlaps that block is excluded from the available space. The button moves to the lower
right with the same edge distances as its initial header placement, then pops
and glows Obsidian purple. Resize and DOM observations also realign later native
layout changes, such as opened tools and loaded images, without waiting for new
response bytes. Reading measures only its own rendered scroller; a retained,
hidden Source widget cannot supply its target geometry. Reduced-motion clients
align immediately and omit the button animation.

The explicit off action retains the button's current position. Off restores the
normal icon color and leaves the viewport in place. Collapsing the response hides
the button, cancels follow, and resets its position to the top for the next
expansion. This also resets a lower button left by an earlier cancellation.
Manual wheel/touch scroll or a native pane scroll from a scrollbar or keyboard
turns follow off and retains the current button position. Follow's own scroll
events do not turn it off. Clicking elsewhere in the app, typing and selecting
text keep it active. Switching to another note pauses viewport work and retains
the choice for that note in that pane; returning restores active follow.
Collapsing turns it off before storing that note's state. Completion, removal,
mode changes and conflicts also cancel active viewport work. State stays in
memory, local to the note and pane, and is never written into the note or
settings. Completed saved history keeps its existing close action and checked
deletion behavior.

Regression tests cover immediate activation, rendered geometry, layout-only
growth, a changing target during the animation, repeated off actions retaining their position,
collapse and re-expansion resetting only the affected response to the top,
manual scrolling, app clicks and selection, note-switch restoration, response identity, Reading's visible viewport,
virtualized widget recovery and listener cleanup. The synthetic native fixture
is prepared with:

```
node scripts/build-native-response-lab.mjs /absolute/new/evidence --scroll-follow
```

For the large-note regression, write `{"large":true}` to `case.json` in the
prepared evidence directory before launching its client. This creates about
489,000 projected characters: 1,000 unchanged paragraphs and 1,200 long response
paragraphs. Type and delete a draft below the response, visit the bottom, scroll
up 2,400 px and issue a `grow` command. The viewport must stay in place with
Follow off. Repeat with editing focus removed and with the cursor at document
start. Check active Follow and a manual scroll during a `burst` separately.
`waitMs` permits a settled observation; `cleanup` removes both temporary notes
through normal vault operations and records `cleanup.json`.

Native parsing can briefly replace a large rendered callout with a shorter
height estimate. The editor then reaches a temporary bottom and can stay pinned
there when the callout returns. Background updates hold a minimum content height
through that transition, without writing a scroll position or changing cursor,
focus or note data. If the native viewport becomes empty, a mapped source reveal
asks CodeMirror to render it again; a scoped scroll handler consumes that reveal's
scroll action. Each guarded update also carries a consumed target so an incomplete
EOF viewport cannot supply an implicit scroll correction between fast updates.
The request tag survives mapping and has no expiry: slow rendering must never
turn a viewport-only request into a real scroll. A valid viewport from the
reader's new position supplies the next target. Normal explicit Follow requests
still use their normal handler.
The minimum is removed after the native block and parser
settle. Completion, note/mode changes, viewport resize, user editing, intentional
folding, a shorter projection and disposal clear it. A shorter projection must
be free to remove its old height. Checks stop polling after five seconds; later DOM
work can wake a still-virtualized guard. The floor is scoped to that pane's
content and survives native replacement of its inline styles.

Its control.json mailbox accepts snapshot, grow (with an optional lines count),
and mode (source or preview). Setup and observations use the real native
projection; activation and cancellation require trusted native input. The
fixture has no Sync connection or native mobile coverage. A QLO2 release still
requires a supported reload and real-client smoke evidence.

## Historical native verification on 2026-10-12 (2.37.15)

The reviewed synthetic client evidence is retained at
`/home/ubuntu/backups/send-to-t3-code/scroll-follow-native-reviewed-20261012/verified.json`.
Obsidian 1.13.7 Live Preview followed from 0 to 909 on activation and to 3,086
as its callout grew to 3,648 px. A real manual wheel moved to 2,486, switched
follow off and kept that position through another 800 px of growth. Reading
aligned its own rendered callout at 3,925 and then 4,725 after growth, leaving
an 8 px gap to its scroller bottom. Screenshots show the purple active icon.
Every observation retained the saved note bytes and editor selection. Separate
native off evidence at `scroll-follow-native-final-20261012/scroll-follow.json`
records the then-random return to the top with the normal icon color. Both random
branches had deterministic regression coverage in that version.

The final Source scroll-key handling and conflict guard are covered by focused
regressions; the native fixture records its exact earlier runtime inputs in
BUILD-SOURCE.json. The canonical build and all 1,385 TypeScript plus 13 Python
tests passed after those guards. Production installation and reload evidence
must be recorded separately through the immutable release workflow.

## QLO2 release 2.37.15

The supported immutable release includes source commits `860144e` and `82aba4a`.
The final build and all 1,386 TypeScript plus 13 Python tests passed. Installation
preserved both plugin settings files, and a fresh Headless Sync scan published
the runtime artifacts. The real QLO2 Obsidian 1.14.4 client reloaded through the
supported command and reported 2.37.15 in instance
`b47a6a96-e459-4b80-9f02-52a8a8adeb06`.

A uniquely owned temporary note followed this existing T3 response. Trusted
native clicks verified immediate following, the purple lower-right icon and
alignment above Obsidian's overlaid status bar in Live Preview and Reading.
Explicit off returned the native icon to the header in its normal color; manual
wheel input cancelled Reading follow and retained older paragraphs through new
stream output. Saved empty-container bytes remained unchanged throughout.
The obsolete agent-authored coordination question was withdrawn without an
answer. Supported removal retired only the temporary binding. Its retained empty
placeholder was backed up before deleting the owned note and closing its tab.
All 46 original leaves, the original active leaf, note bytes, empty search query
and both plugin settings files were preserved. Native desktop screenshots and
checked command results are retained outside the vault.

The immutable completion receipt is
`/home/ubuntu/backups/send-to-t3-code/releases/2.37.15/smoke-vps-qlo2-scroll-follow.json`.
Its evidence records the exact installed runtime hashes, client instance,
screenshots, saved-byte checks and cleanup. Native Windows editing and native
mobile behavior were not verified by this scroll smoke test.

## QLO2 release 2.37.16

Explicit off now always returns the button to the upper-right corner and its
normal icon color without moving the viewport. The build, 15 focused scroll
tests and one release-tool regression passed. The full suite was stopped at the
user's explicit request; immutable provenance and the deployment receipt record
that instruction through the release tool's `--skip-tests-reason` option.

The fresh Sync scan and supported reload loaded 2.37.16 in QLO2 instance
`fcf1f250-9842-46e6-b73d-45095ebf4db9`. Two trusted native on/off cycles in Live
Preview verified the purple lower-right active button and the normal upper-right
button after each off click. Saved test-note bytes stayed unchanged. The existing
native save guard refused the Reading switch with “A finished response cannot
introduce tracking boundaries”; Reading was not smoke-verified in this release.
Native Windows and mobile were not tested.

Supported removal retired the owned temporary binding. The test note and tab
were removed, all 46 original leaves and the original active leaf were retained,
and the original note bytes and empty search query were restored. Both installed
settings files retained their release-time bytes. The completed immutable receipt
is `/home/ubuntu/backups/send-to-t3-code/releases/2.37.16/smoke-vps-qlo2-return-top.json`.

## Historical text-click follow implementation (2.36.12)


Before this change, the native response projection dispatches streamed changes
with `scrollIntoView: false` and maps the current selection. The older public
editor fallback restores the previous scroll coordinates. This is intended to
preserve reading position. There was no explicit follow state; native viewport
anchoring, cursor handling and callout layout could still cause visible movement.

Each native pane now starts with following disabled. A trusted primary click
inside an active response enables following for that response in that pane.
Live Preview and Reading resolve generated callouts by their exact fold key;
Source uses the clicked document position. No proximity-to-bottom heuristic,
cursor position or programmatic render click can enable following.

Clicking outside the response or on an interactive response control stops it.
Wheel scrolling, touch scrolling, scroll keys, scrollbar interaction and text
selection cancel pending scroll work. Returning to the bottom does not enable
following again. Mode changes, completed/removed responses, conflicts and disposal
clear the choice. It is not persisted or synced between devices.

Only a change to the chosen response schedules a scroll. Source and Live Preview
use CodeMirror's scroll effect after rendering, without moving selection or
adding an undo step. Reading aligns the native generated callout's bottom inside
its own scroller. Ordinary background projection updates keep their existing
reading-position behavior.

Eight focused regression tests cover defaults, trusted versus synthetic input,
response identity, cancellation, Source hit testing, Reading, selection, mode
changes, completion, conflict suspension and listener cleanup. The canonical
build and complete 1,178 JavaScript plus 13 Python suite passed. Native fixture
and QLO2 release evidence is retained outside the vault under
`/home/ubuntu/backups/send-to-t3-code/click-scroll-20261009/`.

Native Linux editor checks and Headless Sync delivery do not establish desktop
core Sync-engine or native iPhone/Android behavior. No native mobile client is
available on this host.

QLO2 release **2.36.12** passed native installed-plugin smoke testing after a
guarded client reload. Live Preview stayed at scroll position 0 before a trusted
response click, then followed to 1,061. After manual scrolling, further response
growth left the position at 461. Reading stayed at 409 before a click, followed
to 1,765 after it, and stayed there after an outside click. Source stayed at 512
before a response click and followed to 3,186 after it, without moving the
selection. Synthetic fold clicks did not enable following. All response updates
preserved the saved empty-anchor bytes. The synthetic note was removed and the
original note was restored with its original hash.

The immutable completed smoke receipt is
`/home/ubuntu/backups/send-to-t3-code/releases/2.36.12/smoke-vps-qlo2-click-scroll.json`.
It points to retained native screenshots, exact client instances, runtime
hashes and each measured update. Release installation preserved `data.json`
bytes. Subsequent unrelated thread-selection timestamps were retained; no
synthetic fixture settings were saved. Windows behavior was not smoke-tested.
