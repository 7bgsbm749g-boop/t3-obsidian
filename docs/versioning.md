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

Every PR needs a numeric `0.0.BUILD` newer than its target branch, including
product, documentation and workflow changes. After fetching `origin/main`, run
`python3 scripts/github_release.py bump --base origin/main` in the task checkout.
This command selects the next number above the source, target and recorded
numeric version history. It aligns `manifest.json`, `package.json`, both
package-lock version fields and the `versions.json` compatibility entry.
Commit these files with the PR. The command changes only version metadata;
it does not create tags or publish. Do not run it again for each test build.

The `Release / version` check tests the release tools and checks the PR's
aligned version against its target. Update the branch and bump again if another
PR merges with the same or a newer number. Keep PR branches current before
merging; version checks from an older target are not proof of a current bump.
A bumped manifest identifies the source base used for feature-labelled test
builds. Keep test labels out of tracked version metadata and public releases.

At midnight UTC each night, GitHub schedules a release of the `main` commit
selected by that scheduled event. Only that snapshot is tagged, built, attested
and published; unmerged PRs are not included. Intermediate PR versions need not
be published. An unchanged, already published snapshot is skipped. GitHub may
delay the scheduled start; midnight is the requested start, not a guaranteed
publication time.

The schedule does not choose or bump versions. It uses the number already
committed on `main` and refuses to reuse a tag for another commit or release a
version older than the latest release. An interrupted run can retry the same
tag without replacing it. Explicit numeric tag pushes can still start a manual
release; workflow dispatch at that tag can retry its build and publication.

The local release queue and version allocator remain removed. Personal-vault
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
