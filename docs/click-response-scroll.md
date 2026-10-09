# Click-controlled response scrolling

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
