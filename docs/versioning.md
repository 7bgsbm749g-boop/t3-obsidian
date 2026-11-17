# Alpha version policy

The project remains in **alpha**, with plain **`0.0.BUILD`** versions in the
Obsidian manifest, package files, compatibility map, and matching release tag.
The GitHub title is **t3-obsidian VERSION**, without a development-stage label.
Alpha is the development stage; do not add it to new titles, versions, or tags.
The Obsidian display name stays **T3 Code**.

Only an explicit user instruction can end alpha. A breaking change, large
feature, or high build number does not authorize graduation. Keep all version
files aligned for a release and preserve every published version.

## PRs and releases

PRs keep their numeric source version during development, including product,
documentation and workflow changes. Test builds add a feature label to that base
without reserving a public number. Keep test labels out of tracked metadata.

After any user or agent merges a PR, a push to `main` starts
[Assign merged PR versions](../.github/workflows/pr-versions.yml). This runs on
standard GitHub Actions with the repository's `GITHUB_TOKEN`; no Pro plan, PAT,
local daemon or agent is required. It assigns versions after merge rather than
changing development branches, so new PRs do not fight over version-only edits.

On first use the workflow detects the merge that introduced the ledger, then
reconciles that PR and later merges. It saves the cutover in
[`pr-versions.json`](../pr-versions.json). PRs merged before activation retain
their historical versions. It reads the current main metadata, other open PR manifests at their
exact heads (including forks), numeric release tags and recorded history. It
selects the next unused number and atomically commits all four version files and
a PR receipt. The receipt records the version and original merge commit.
Each PR gets one receipt; reruns do not consume another number.

Assignments run one at a time in a shared concurrency group with `queue: max`.
Each run reconciles all pending PRs in merge order, so delayed or missed events
are recovered. A non-forced ref update protects merges that arrive during a
write; a confirmed conflict rereads main and retries. An uncertain response or
permission error stops the run. The next reconciliation checks the committed
receipts before doing anything further. It never force-pushes or rewrites tags.

Development CI verifies aligned metadata without an early bump. Merging agents
use normal reviewed-head checks and do not run version allocation themselves.
Do not edit the generated ledger or bump metadata during development.

At midnight UTC each night, GitHub schedules a release of the `main` commit
selected after reconciling pending PR assignments. Only that completed version
snapshot is tagged, built, attested
and published; unmerged PRs are not included. Intermediate PR versions need not
be published. An unchanged, already published snapshot is skipped. GitHub may
delay the scheduled start; midnight is the requested start, not a guaranteed
publication time.

Nightly preparation shares the assignment queue and first reconciles pending
merges. It then checks out the exact completed metadata commit returned by that
step, even if another merge arrives meanwhile. It refuses to reuse a tag for another commit or release a
version older than the latest release. An interrupted run can retry the same
tag without replacing it. Explicit numeric tag pushes can still start a manual
release; workflow dispatch at that tag can retry its build and publication.

The local release queue and worker remain removed. Personal-vault
delivery is separate and requires an explicit user request; no PR, main merge
or GitHub release requires it. See [Review and release checks](review-and-release.md).
[release-policy.json](../release-policy.json) and `scripts/release_policy.py`
remain inputs to the GitHub release workflow. The nightly schedule becomes
active only after its workflow is merged into the default branch.

## Historical records

Preserve existing tags, archives, receipts, private source refs, and private
Markdown/CSV comparison tables. Keep original numbers, links, all alternative
version columns, and delivery states. These private records are historical;
they are no longer updated by a local release worker. Do not upload private
thread records or evidence to GitHub.

The original `2.45.81` to `0.0.377-alpha` transition and the later correction to
plain numeric alpha builds remain historical facts. Do not renumber them,
rewrite immutable assets, or let older `2.x` numbering replace the alpha
sequence. Keep every comparison format until the user explicitly leaves alpha.
