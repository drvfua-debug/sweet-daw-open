# Security Policy

## Supported code

Security fixes are evaluated against the current open-source release line and active development branch. Older snapshots may not receive backports.

## Reporting a vulnerability

Do not include credentials, private audio, personal data, or exploitable secret material in a public issue.

If GitHub private vulnerability reporting is enabled for the public repository, use that channel. Otherwise, contact the repository maintainer through the GitHub profile and request a private channel before sharing sensitive details.

Please include, where applicable:

- affected version or commit,
- reproduction steps,
- security impact,
- browser/device information,
- whether the issue affects local-only processing or any deployed web surface.

Sweet DAW is designed so imported audio is processed locally in the browser. A change that introduces remote upload, third-party API calls, analytics involving audio content, or credential handling must be explicitly documented and reviewed before release.
