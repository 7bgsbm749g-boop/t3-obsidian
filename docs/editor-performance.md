# Editor performance and response recovery

Logging remains disabled. Response location recovery builds a shared index on
its first miss, reads newly appearing paths incrementally, and immediately
refreshes files reported by vault/editor change events. Repeated missing
responses no longer reread the entire vault every three seconds. An independent
fallback sweep catches missed events after two minutes, then four minutes,
then at most once every five minutes. A move arriving through an observed event
or a newly appearing path bypasses that delay. Duplicate identities still pause
writing, code-fenced example markers remain excluded, and removed response
markers still reach the conflict guard.

Marker indexing parses each document once instead of once per response ID.
Markdown code ranges are reused for identical source text, bounded to 32 entries
and two million retained source characters; callers receive independent copies.
Marker-free documents skip code parsing.

Folder badge observers attach only to file explorer containers. Workspace
layout changes rebind them when an explorer opens, closes, or is replaced.
Typing, scrolling, and reply rendering outside the explorer do not schedule
folder decoration.

A read-only reproduction against QLO2's 513 Markdown notes read 514 paths on
initial recovery, then only the missing preferred path on subsequent rounds.
Repeated rounds took about 2ms on the VPS, compared with the earlier 0.8–1.3s
full scans. This is a source benchmark, not a Windows typing latency measurement.

## Container marker edits

The container editor extension introduced in 2.37.12 parsed the complete note
with the CommonMark code-range query after every document change. The corrected
extension indexes marker candidates in CodeMirror's Text rope, rescans changed
lines and touched HTML tags, and reuses unchanged blocks in a private incremental
Markdown syntax tree. Notes without container candidates never start that
parser. The native editor language is not replaced. Literal fenced, indented,
inline and HTML code examples remain visible; Source and Live Preview retain
hidden container separators and atomic cursor ranges.

The parser loads only when an editor needs it. Account startup, command readers
and mobile startup retain their existing lazy editor-runtime boundary. Regression
checks cover ordinary typing, code-context changes, marker edits, line joins,
multiple changes, multiline HTML tags and exact saved bytes. A 480,000-character
typing check rejects any call to the full-document CommonMark code-range query.

The retained controlled comparison is under
`/home/ubuntu/backups/send-to-t3-code/typing-fix-20261012/`. The 2.37.13 source
required a median 1,018 ms per legacy-note edit and 1,008 ms per container-note
edit. The candidate measured 0.039 ms and 16.7 ms respectively. These are
synchronous Node CodeMirror measurements with synthetic content, not Windows
keyboard or paint timings.

The isolated native Obsidian 1.13.7 client independently checked 480,000-character
notes in Source and Live Preview. Median synchronous native transactions were
27–49 ms, every saved byte was preserved, both container boundaries stayed
hidden, and literal examples stayed visible. This unsynced fixture does not
establish live QLO2 deployment, Windows native input, or mobile behavior; release
receipts and real-client smoke evidence remain the deployment authority.
