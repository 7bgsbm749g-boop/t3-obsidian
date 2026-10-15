# Smart Send

Smart Send replaces the former full-note/selection split. Every manual note,
selection and typed Ask uses the same confirmed source record for its note,
destination machine, project and thread. The command bar remains a direct Ask
surface. Note and editor menus also provide the bottom Ask composer.

Only additions are sent, in current note order. Removals produce no message;
replacement text is added text with no correction/deletion labels. Preparing a
request does not confirm coverage. The immutable request captures its source
and covered character intervals before dispatch; confirmed T3 acceptance
records that exact capture, including acceptance recovered after a local error.
Typing during delivery is not included in that capture.

Unchanged lines map coverage to the current note, with common prefixes and
suffixes inside changed intervals. Repeated lines retain occurrence counts.
Explicit selections cover only their requested intervals. New destinations
start with no coverage. Typed questions always send independently of source
coverage. An Ask about already delivered selected source includes a bounded
160-character reference. An explicitly selected generated reply remains
available as quoted Ask context, including when choosing another thread.
No new source for the default destination opens the selector and
hides its previous/continue action; an explicit empty submission shows the
short no-content notice.

`data.json.smartSend` holds stable note identities, compressed current source
snapshots, confirmed heads, retirement IDs, and response records. A snapshot
successor retires only the heads it observed. Merge retains independent
confirmed branches and unions their coverage on the next send. Retirement IDs
prevent stale settings from restoring superseded heads. A local replica repairs
stale whole-settings replacements. Note identities follow rename and deletion.
This is not a cross-device delivery lock: simultaneous unsynced sends can both
be accepted before either device receives the other's receipt.

Completed and frozen response bodies are recorded before their checked native
write. Rendered output, including progress and input echoes, is stored once by
SHA-256; gzip is used when its base64 form is smaller than the original text.
Current source snapshots use the same encoding. No new markers, comments or
boundaries are written to Markdown. Full body matches exclude saved responses;
unique surrounding text can locate edited responses and retain user additions.
Active response containers and recognized generated progress callouts are also
excluded. Ordinary quotes and literal marker examples remain source.

Older note replies can be recovered from canonical T3 snapshots for their known
note/thread bindings. Only complete-line, unique rendered matches are recorded;
recovery does not rewrite the note. Arbitrary unmarked or independently edited
historical prose without a verifiable source cannot be classified perfectly.

Verification covers additions and removals, selections, repeated lines, source
edits during sending, question-only sends, response edits, compression, device
branch merging, stale settings, note lifecycle, selector behavior, composer
drafts, and the actual bundled Send/Ask preparation. Release smoke evidence is
recorded through the supported QLO2 release receipt. VPS desktop results do not
establish native iPhone or Android keyboard and selection behavior.
