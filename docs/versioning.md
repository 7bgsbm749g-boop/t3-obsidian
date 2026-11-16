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

Immediately before an explicitly authorized merge, the merging agent fetches
and integrates the target, then runs this in the clean PR checkout:

```sh
python3 scripts/github_release.py prepare-merge --repo OWNER/REPO --pr NUMBER --base origin/main
```

The command reads the target version, every other open PR's manifest at its exact
head (including forks), existing numeric release tags and local compatibility
history. It selects an unused number above the known inventory and aligns
`manifest.json`, `package.json`, both package-lock version fields and
`versions.json`. A still-valid allocation for this PR is retained across retries.
Reads that fail stop allocation without changing metadata. It never assigns a
number merely because a PR was opened or marked ready.

The agent commits and pushes the metadata, finishes checks and reviews, then
fetches and rechecks immediately before merging:

```sh
python3 scripts/github_release.py validate-merge --repo OWNER/REPO --pr NUMBER --base origin/main
```

If a version is now claimed, published or older than the target, the agent
updates and prepares again. The final check also rejects a dirty checkout,
changed PR head, draft PR or target that has not been integrated. Merge only the
checked head with an expected-head guard. Serialize authorized merges; inventory
reads are not remote reservations. The agent handles retries and version-only
conflicts, without asking the user to choose numbers. Neither command merges,
pushes, creates tags or publishes anything.

The `Release / version` check tests the tooling and verifies aligned metadata
for development PRs without requiring an early bump. Merge-time checks are the
merging agent's responsibility, as specified in [AGENTS.md](../AGENTS.md).

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
