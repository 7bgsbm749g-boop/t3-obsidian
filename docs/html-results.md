# HTML result integration

Completed T3 `html_render` dynamic-tool items become `response.html` activities.
Their small attachment references survive bounded snapshots and binding recovery.
They are not ordinary tool history, so folding or removing intermediate output
cannot discard a page. The final note keeps a `t3-html` fenced reference. HTML
bytes, credentials and signed URLs never enter that reference or plugin settings.
No T3 backend changes or browser process per note are required.

## Verification and storage

`HtmlResultStore` first checks its device-local cache. A cache fill reads the
canonical item by exact thread, run, item and revision, requires a successful
`html_render` result with the same attachment, then calls `assets.createUrl`.
Only a current signed `/api/assets/` URL on that verified environment is accepted.
Downloads require HTML MIME, valid UTF-8, nonempty bytes and the 25 MiB page limit.
Every retained cache entry carries its source identity and a SHA-256 checksum.

Cache bytes live in the existing IndexedDB devices store, scoped to the vault.
The persistent index retains up to 64 pages and 100 MiB. Old payloads are released
when that budget is exceeded. Warm text has a separate eight-page/32-million-
character limit, and concurrent requests for one result share a fill. Unload
closes frames and object URLs and prevents late downloads from publishing bytes.
Attachment downloads do not delay final reply saves.
Cache read/write and connection-cleanup failures are nonfatal after a verified
download. The current viewer and its warm cache still receive the unchanged page;
a later offline reopen requires a successful persistent save.

Offline playback means a cached, self-contained page remains interactive without
T3. It does not include uncached remote libraries, fonts, images or live APIs.
Each device must fetch a page before offline use; Obsidian Sync carries the small
note reference, not this cache. Eviction, missing bytes or unavailable connections
produce a compact Retry placeholder. Loading and failed cards use content height
instead of reserving the page's 80–2000 pixel height. The message distinguishes a
required sign-in, connection failure, HTTP failure, source verification failure,
and invalid attachment content. No vault attachment directory is created.

### Host access integration

`HtmlResultStore` accepts an optional fourth argument with `isSignInError(error)`
and `onDiagnostic(diagnostic)`. Pass the host's typed sign-in-required predicate;
HTTP 401 is also classified as sign-in-required. Other HTTP statuses retain their
numeric status. Rejections are `HtmlResultError` with fixed public messages,
`code`, `stage` and optional numeric `status`. Diagnostics use only those three
fields, including nonfatal `cache-read`, `cache-write` and `close` events. Raw
server text, causes, credentials and signed URLs are never copied into errors,
diagnostics or viewer text.

`HtmlResultViews` accepts `{onSignIn(environmentId)}` as an optional third
argument. This adds a **Sign in** button only to sign-in-required cards. The
callback opens the host's account UI. After successful sign-in or a successful
connection recovery transition, the host calls
`await views.recover(environmentId)`; omit the argument only for an account-wide
transition. Call this once per successful transition, not on every stream item,
access request, or diagnostic. Calling it from the access factory before the
pending viewer has failed does not recover that viewer.

Each call makes one attempt for failed connection/sign-in/HTTP cards in that
environment. Concurrent calls and duplicate mounts share pending work. Loaded
frames, disposed views, and failed identity/content verification do not retry.
Manual **Retry** remains available for all failures. There are no background
retry timers or automatic download loops. The optional callbacks default to no
action, so existing callers remain compatible; the host must wire the recovery
transition to enable automatic recovery.

## Native presentation

Reading mode uses a registered Markdown code-block processor. Live Preview uses
direct CodeMirror block decorations and atomic ranges. The source fence stays
visible in Source mode. Widget identities survive ordinary edits and streaming
updates through widget equality. Each Live Preview document change reparses
Markdown once so that list markers, indentation, or plain letters which change
an HTML block's context also remove or restore the correct widget. Non-document
transactions keep the current decoration set. Each viewer uses its own owner
document, including popouts.

The viewer loads the prepared T3 document from a local blob URL in an iframe with
`sandbox="allow-scripts allow-forms"`. It never allows same-origin access.
The parent recognizes only size, theme, bounded Escape, and HTTP(S) link messages.
Link and Escape requests must come from that exact focused frame while the host
has user activation. No plugin or Node API is exposed. A local content policy
excludes file and Obsidian protocols. The original HTML remains cached unchanged;
the render copy adds this policy and Escape handling.

T3's existing bootstrap receives the Obsidian theme before first paint through
the `t3-theme` fragment, then follows CSS changes through its normal host-context
messages. T3 role variables map to native Obsidian colors and fonts. Width and
reported content height use T3's fit/cap rule, bounded to 80–2000 CSS pixels.
The Expand action opens an Obsidian modal with zoom. Inline controls appear on
hover, focus and touch. Authored HTML, scripts, SVG, canvas and page controls stay
inside the isolated document; general assistant HTML remains escaped.

## Validation

Run `npm run build` and `npm test`. Dedicated tests cover provider result
envelopes and error flags, malformed references, literal examples, snapshot/event
deduplication, bounded recovery, result retention outside folds, frame sizing,
exact source verification, path normalization, cache corruption, concurrent fills,
offline reopen and cache retirement. Receiver coverage uses independent sender
and receiver caches, not a warm reopen of the sender cache. Production viewer
tests cover compact state transitions, explicit sign-in, scoped one-shot
recovery, unchanged sandbox flags, coalesced loads and disposal. Editor probes
load the production extension and run real CodeMirror transactions for list and
HTML-block context edits, normal typing, newlines, mode changes, replacement and
restoration. The asset adapter has a focused RPC check.

Build an isolated real-client fixture outside all source and synced vaults:

```sh
node scripts/build-native-response-lab.mjs NEW_PRIVATE_EVIDENCE_DIRECTORY --html
```

Launch its returned profile using Cua Driver. The fixture verifies Live Preview,
Reading mode, Source mode, frame identity during surrounding edits, sandbox/Node
isolation, persistent bytes, an offline reopen with network access refused,
list/HTML context edits in the real editor, and a cold receiver with separate
storage which recovers only after access is restored. The cold receiver's failed
card must measure at most 180 pixels before its first verified download.
It saves `RESULT.json` and mode screenshots. Synthetic native evidence is under
`/home/ubuntu/backups/send-to-t3-code/html-results-20261015-lab-5/` (Obsidian 1.13.7).
Keep failed attempts for diagnosis. They are not release smoke evidence.

Phone-to-laptop HTML repair evidence is retained in
`/home/ubuntu/backups/send-to-t3-code/html-phone-switch-20261019-5096443c-1/`
(Obsidian 1.13.7). All 15 checks passed, including a 64-pixel failed receiver
card, a separate receiver download after access returned, both Markdown-context
repairs, and frame retention during normal typing. `BUILD-SOURCE.json` identifies
the tested source bytes. This uses synthetic APIs and separate cache scopes in
one unsynced desktop client; it does not test real account renewal, two-device
Sync, Windows or native mobile behavior.

Release acceptance additionally requires a real HTML attachment and canonical
result reference, the installed QLO2 client after Sync and native reload, actual
page interaction, expansion, and screenshots outside the vault. Preserve the
user's original note and settings. Record the exact release using
`--complete-smoke`; a packaged release alone remains incomplete.

Native iPhone and Android behavior is not established by the Linux desktop lab.
The independent Headless Sync lab does not supply native mobile coverage.

## Upstream contracts

Compared the running nightly `v0.0.46-nightly.20261008.2849` with upstream
`42da166d131017335a1158d0b379dd68b8985796` (2026-10-15):

- `packages/shared/src/htmlRender.ts`: reference, sizing, theme and message protocol.
- `packages/shared/src/toolOutput.ts`: bounded provider-envelope recognition.
- `apps/server/src/htmlRender/HtmlRender.ts`: prepared, stored HTML attachments.
- `apps/web/src/components/chat/HtmlRenderFrame.tsx`: inline iframe and expansion.
- `apps/web/src/components/files/BrowserDocumentFrame.tsx`: sandbox and source checks.

The upstream repository is <https://github.com/pingdotgg/t3code>.
