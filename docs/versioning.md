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

Ordinary development work ends in a reviewed commit and PR. PRs and merges to
`main` do not require a new version, including product, documentation and
workflow changes. Retain the existing manifest and package versions during
ordinary work. No branch push assigns a version, creates a tag or publishes.

Only a GitHub release requires a new unused `0.0.BUILD`. When a release is
explicitly requested, align `manifest.json`, `package.json`, both package-lock
version fields and the `versions.json` compatibility entry, then tag the exact
release commit with that version. Pushing that numeric tag starts GitHub's
build, attestation and publication. The workflow checks that source and tag
versions agree; it does not choose or bump versions. Dispatch at the same tag
can retry a failed release without changing its source or assets.

The local release queue and version allocator remain removed. Personal-vault
delivery is separate and requires an explicit user request; no PR, main merge
or GitHub release requires it. See [Review and release checks](review-and-release.md).
[release-policy.json](../release-policy.json) and `scripts/release_policy.py`
remain inputs to the GitHub release workflow.

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
