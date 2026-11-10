# Activity text shine

Shine is the plugin's only loading decoration. Active navigation titles, response
headers, activity labels, individual running tools, context compaction, worktree
setup labels, file-opening notices and running entries in the run picker use the
same moving highlight. No loading rings, segmented circles or circular status
borders are drawn. Worktree stages retain non-circular terminal status icons.

Saved loading markers remain hidden because Stop and recovery use their
identities. Individual tools use their existing `inProgress` status to select
their label; completion, failure and Stop remove the shine without adding new
markers to saved responses. Native response reconciliation preserves the client
animation phase and discards old circle decoration.

## Paint and typography

The highlight has a 4.5 rem width, a white core from 40% to 60%, and a 2.2 second
cycle. `--send-to-t3-shine-highlight` controls only the moving layer's white mix.
Its default is 100%, preserving the accepted white core. Changing that mix does
not change ordinary glyph painting outside the highlight.

`--send-to-t3-shine-text-opacity` is an independent foreground-paint setting:
50% in dark themes and 74% in light themes. The dark setting retains the accepted
appearance previously called 50% strength. Every light-theme label now uses the
former selected-title appearance, replacing the weaker unselected-label setting.
Selected and unselected titles share the same per-theme paint rules. Native
title fonts remain theme-owned.

Thinking, tool, compaction and setup rows share the interface font, UI-small
size, normal weight and muted colour. Absolute UI sizing prevents nested tool
groups from shrinking their labels again. Error and warning colours remain
available for terminal statuses.

The shared observer pauses hidden and offscreen labels. Reduced motion,
forced colours and unsupported gradient-text features keep ordinary text.
Explorer decorations cover every existing and future workspace document and
clear only the closed window's decorations when it leaves the workspace.

## Verification

Use affected test selection with `npm run test:plan` and `npm test`; lint must
have zero errors or warnings and the production build must pass. Regression
coverage includes tool status changes, native reconciliation, legacy circle
cleanup, pause/disposal behaviour and added/removed explorer roots.

Check native Reading and Live Preview in both themes. Confirm that active tool
entries, setup labels, notices and run-picker labels shine without rings; then
confirm that Stop and completion clear their shine. Compare selected and
unselected title contrast in the light theme. Check existing and newly opened
pop-out explorers and their cleanup.

Compare rendered pixels with the highlight outside the text in the same
position, theme, selection state and custom colours. Also vary only the
highlight control and confirm unchanged baseline glyph pixels. Record deliberate
activity typography and light-theme contrast changes separately. Retain native
screenshots outside vaults and source checkouts. Use synthetic fixtures only in
a separate test vault; QLO2 must receive no test content. Desktop evidence does
not establish native phone behaviour. Source-only work does not install or
release the plugin.

## Regression cause

The 2.45.9 change replaced the foreground text fill with full transparency and
used a clipped background to draw all letters. That can change antialiasing and
apparent weight. Matching font properties, colour and dimensions did not prove
that the text looked the same. The previous checks measured animation contrast,
but omitted a rendered comparison against the accepted version. The assurance
that normal text was unchanged therefore exceeded the evidence.

The repository's visual-change guidance now requires both the unchanged-text
comparison and the intended-effect check, and limits platform claims to the
clients actually tested.
