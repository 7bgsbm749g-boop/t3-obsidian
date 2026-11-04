# Immediate Send feedback

Send and Ask reserve their streaming box synchronously, before conversation checks,
smart-send preparation, project creation, images, title lookup, or dispatch.
Opening the destination chooser alone does not show a block. Its Send actions
start the indicator before awaiting a pending conversation check. Inline Off
does not create the indicator.

The pending box uses the live response Markdown generator in its Sending phase
and Obsidian's native Markdown renderer. It has the real collapsible callout,
timer, spinner, and activity content, rather than a hand-built header. Its title
is the source note's basename, independent of automatic thread-title settings,
and its status is **Sending**. Prepared responses also retain Sending until
the live feed supplies the running response and canonical thread title.

The pending box is held in a CodeMirror block decoration, or a temporary Reading-view
element. It never enters editor text, saved Markdown, undo history, Sync, image
snapshots, or the outgoing prompt. It uses the captured response position and
maps through editor changes. Nested preparation scopes share one box. The native
Markdown render component is unloaded when its widget or Reading element is removed.
Preparation hands it off to the real response block; failure, cancellation,
empty input, conversation timeout, and unload remove it. Existing response
ownership checks still decide steering and dispatch.

Regression coverage exercises synchronous creation before project lookup and
conversation checks, mapping during typing, selection retention, nested scopes,
handoff, retries, cleanup, and disabled streaming paths. The native fixture is
`validation/immediate-send-lab.ts`, built with
`node scripts/build-native-response-lab.mjs evidence/TASK/native --immediate-send`.
It uses a separate unsynced Obsidian vault, delays and cancels preparation before
external dispatch, captures editor and Reading-view behavior, and deletes all
fixture notes through the vault API. It does not test real provider delivery,
Obsidian Sync propagation, or native iPhone/Android UI. QLO2 delivery separately
requires exact installed bytes, a fresh Sync scan, and a real client reload.
