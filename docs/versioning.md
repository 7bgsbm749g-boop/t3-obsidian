# Alpha version policy

The project remains in **alpha**, with plain **`0.0.BUILD`** versions in the
Obsidian manifest, package files, compatibility map, and matching release tag.
The GitHub title is **t3-obsidian VERSION (Alpha)**. Alpha is a display label,
not a version suffix. The Obsidian display name stays **T3 Code**.

Only an explicit user instruction can end alpha. A breaking change, large
feature, or high build number does not authorize graduation. Keep all version
files aligned for a release and preserve every published version.

## PRs and releases

Ordinary development work ends in a reviewed commit and PR without a version
bump. Release work stays on GitHub after PR review. The local version allocator,
queue, packaging, deployment and publication tools have been removed. This
change adds no replacement release automation. See
[Review and release checks](review-and-release.md).

The existing GitHub provenance workflow verifies the exact numeric tag against
`manifest.json`, `package.json`, both package-lock version fields, and the
`versions.json` compatibility entry before building and attesting assets.
A source push or PR does not authorize a release tag or publication.

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
