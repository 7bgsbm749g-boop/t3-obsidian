# Alpha version policy

The project remains in **alpha**, with plain **`0.0.BUILD`** versions in the
Obsidian manifest, package files, compatibility map, archive, and matching Git tag.
Each newly packaged release advances BUILD once. The GitHub title is
**t3-obsidian VERSION (Alpha)**. Alpha is a display label, not a version suffix.
The Obsidian display name stays **T3 Code**.

[release-policy.json](../release-policy.json) enforces this rule. Stay in alpha
until the user explicitly says to leave it. Neither a breaking change, a large
feature, nor a high build number authorizes graduation. Retrying an existing
immutable archive keeps its version and bytes. Do not add `-alpha` to new
manifests or tags; Obsidian's documented distribution format is plain `x.y.z`.

## Comparison history

The release queue maintains private Markdown and CSV tables under
`evidence/version-history/` in the integration checkout. They preserve the
reviewed historical rows, links, original numbers, and all alternative version
columns. Registered existing task-worktree evidence directories receive the
same updated tables. Do not publish these private thread records to GitHub.

Every newly assigned release adds one row with its source commit, thread link,
change description, comparison versions, and delivery status. Packaging,
installation, and completed live verification update that row. Retries do not
add another row. Failed candidates remain traceable; archived bytes and old
release records remain immutable. Keep every comparison column until the user
explicitly graduates from alpha.

New plugin releases have one commit on `main` combining source changes and all
version files, titled `Release VERSION: summary`. Its commit ID is the archive
and deployment provenance. The private history still records the original task
source commit and thread link. Local queue refs preserve source ancestry without
adding task commits or merge commits to the public release history. Historical
releases and already packaged retries retain their existing records.

Use `--thread-id ID --summary "CHANGE"` with `--enqueue HEAD` to record the
owning T3 thread and a useful public commit description. Use `--release-type patch`, `minor`,
`major`, or `none` for the alternative comparison counters. This classification
does **not** change the published alpha format, including for prepared candidates:

- `patch`: correct behavior without removing a supported capability.
- `minor`: add a compatible capability or deprecate one.
- `major`: remove or incompatibly change a supported command, workflow, setting,
  saved-note format, or connection requirement. The major-zero comparison
  advances its minor component instead of leaving zero.
- `none`: documentation, tests, source moves, or delivery tooling alone. The
  semantic comparison counters stay unchanged. Such work normally integrates
  without a plugin release; an explicit delivery-tool verification release
  still advances its alpha build.

These comparison rules follow the chosen historical interpretations of
[Semantic Versioning](https://semver.org/), rather than claim that the old
numbers prove one uniquely correct reconstruction. The current alpha label is
an explicit development policy, not a promise of a stable public interface.

## Historical transitions and distribution

The original `2.45.81` → `0.0.377-alpha` transition remains a historical record.
After the suffix-format correction, the queue continues from the highest alpha
build, including prior suffixed versions and reserved numbers, and assigns the
next plain numeric build. Older `2.x` receipts must not override that sequence.
Never rewrite historical tags, archives, receipts, or comparison rows. The
reviewed private seed is supplied once with `--history-seed PATH`; later jobs
use the retained history.

For separately authorized GitHub publication, publish a regular release with
matching numeric tag and manifest, and keep Alpha in its title and description.
A source push does not create a release or advance the plugin version.
The GitHub prerelease flag is not the
project's development-stage switch. Confirm the current
[Obsidian submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
when submitting or resubmitting to the plugin directory.

New GitHub release assets must carry provenance for their exact numeric tag and
reviewed queue commit. Use the checked publication procedure in
[Review and release checks](review-and-release.md). This does not change alpha
numbering, private comparison counters, or immutable historical releases.
