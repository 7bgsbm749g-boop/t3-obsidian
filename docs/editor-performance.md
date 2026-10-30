# Editor performance and response recovery

## Large retained HTML and tool history

Completed, untracked, initially collapsed generated history keeps its original
header and exact saved bytes. Live Preview receives a small protected reference
before native editor initialization. Opening the history renders its body;
nested tools load only when opened. Source mode retains the complete source.
Save, selection, undo, whole-group removal and conflict recovery map references
to retained canonical bytes. Detached views keep exact late-save data without
rebuilding an editor which is closing. Plugin unload restores live editors.

History discovery uses CommonMark flow tokens without allocating the inline
AST of escaped tool output. Bounded presentation and flow caches retain up to
eight million characters; unusual literal contexts and response boundaries keep
the full validation path. Ordinary paragraph edits map already validated ranges;
structural edits still validate context. Media source lookup is bounded and
cached, and native image links bypass unnecessary Markdown parsing. Approval and
question decorations no longer rebuild on viewport-only scrolling.

The October 30 native investigation retains its private fixture, scripts,
input hashes, resource logs, raw timings and recordings under the task's ignored
`evidence/live-preview-baseline-20261030/` and
`evidence/scroll-wheel-baseline-20261030/` directories. No private note source or
test fixtures enter QLO2. Counterfactual controls decode HTML while preserving
Markdown quote continuations; a smaller visible-text control also removes hidden
tool output. Both run the full plugin in the same isolated Linux Obsidian 1.14.5
client. Cached synthetic pages make startup reproducible; original page programs,
network latency, physical display scanout and native mobile are outside this
measurement. App frames and native wheel events are recorded independently of
renderer JavaScript. Pixel comparisons use the same source, theme, position and
fold states, with the pointer outside the note.

In the frozen 3,577,571-character investigation note, the candidate editor holds
18,681 display characters while retaining the complete source. Against its
3,011,889-character full-text no-HTML counterfactual, all recorded first-open
and warm median timing categories and available edit/scroll p95 distributions
met the HTML ≤ 1.30 × plain target. Stable first open was 605 ms versus 1,006 ms;
warm reopen was 396 ms versus 641 ms. Warm ordinary edits took 33.4 ms versus
104.2 ms to two frames; viewport scrolling took 38.8 ms versus 34.9 ms.

The smaller 152,460-character visible plain control also passed the primary
user-visible latency gates. Native wheel recordings used twenty small inputs
per note to avoid scroll boundaries: HTML median/p95 visible response was
86.5/144 ms versus plain 89.5/166 ms. All forty inputs moved visible content;
neither recording had a 200-pixel blank-strip candidate. Normal note pixels
matched the accepted source exactly in both closed and expanded history states
in the default light-theme fixture. First-open has one sample, reopen four,
edits 48 and viewport scroll 40; these are bounded measurements, not guarantees
about every device, theme or HTML document.

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
