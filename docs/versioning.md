# Version policy

t3-obsidian uses [Semantic Versioning 2.0.0](https://semver.org/) for new releases. Its public contract includes supported commands and agent interfaces, documented Send and Ask behavior, folder and thread workflows, saved-note formats, settings compatibility, and required Obsidian and T3 connection capabilities.

- A patch fixes incorrect behavior while preserving that contract. Performance fixes and compatible recovery fixes normally belong here.
- A minor release adds a compatible capability or marks a supported capability as deprecated.
- A major release changes that contract incompatibly. Examples include removing a supported workflow, removing a command without a compatible replacement, or abandoning supported saved state.
- Documentation, tests, build changes, and release tooling alone do not require a plugin release. A large refactor or a new product name alone does not establish an incompatibility.

Assess migrations by the commands, settings, data, and behavior they preserve. Explain any manual upgrade steps and any capability that will stop working. A dependency or connection change needs a compatibility review when it changes supported installations.

Existing release numbers, tags, archives, and receipts remain historical records. Do not rename them to make old releases appear compliant. Publish corrections and future changes under a version newer than the latest installed and published release. Historical research can propose an alternative sequence, but that sequence does not replace existing versions.

Major-zero versions describe initial development with an unstable public contract. A historical version number alone does not prove that its change was compatible or breaking.

For a queued release, use `--enqueue HEAD --release-type patch`, `minor`, or
`major` after reviewing the combined changes. The queue assigns the version
against the latest release; tasks do not reserve numbers. The compatibility
default remains `patch`. An exact prepared candidate uses its validation proof
instead of `--release-type`.
