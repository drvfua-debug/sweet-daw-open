# Sweet DAW Governance

Sweet DAW is currently a maintainer-led open-source project. This document explains how decisions are made today and how governance can evolve as the contributor community grows.

## Maintainer

The repository owner, `drvfua-debug`, is the current main maintainer and final decision maker for releases, security-sensitive changes, licensing, project direction, and repository administration.

## Contribution model

Anyone may propose changes through issues or pull requests.

Contributions are evaluated on:

- correctness and test evidence,
- audio quality and non-destructive behavior,
- mobile/browser performance,
- security and privacy,
- license and provenance clarity,
- maintainability and scope,
- alignment with the public roadmap.

There is no requirement that a proposal be accepted simply because an implementation exists. Maintainers should explain material rejections when practical.

## Technical decisions

Small, reversible changes can be accepted through ordinary pull-request review.

The following require explicit maintainer review and should include written rationale:

- persistent project schema changes,
- new runtime services or remote audio upload,
- credential handling,
- external model weights or binary DSP dependencies,
- licensing changes,
- changes that materially alter audio routing, export behavior, or project compatibility,
- security-sensitive architecture changes.

When evidence is mixed, the project favors the safer and more reversible option until stronger tests, measurements, or listening evidence are available.

## Releases

The main maintainer currently prepares releases. A release should normally require:

```bash
npm ci
npm run typecheck
npm run test
npm run build
npm run aimix:selftest
```

Additional audio regression checks should be run when redistributable fixtures are available.

Release notes should call out breaking project-format, DSP, browser-support, security, or licensing changes.

## Security

Security reports follow [SECURITY.md](SECURITY.md). Security fixes may be handled privately until a coordinated fix or disclosure is ready.

## Community standards

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Moderation and repository administration are currently handled by the main maintainer.

## Becoming a maintainer

There is no automatic maintainer promotion threshold yet. As the project develops recurring contributors, additional maintainers may be invited based on sustained, trustworthy participation across code review, issue triage, documentation, testing, releases, or security work.

Future maintainers should demonstrate:

- consistent constructive participation,
- sound technical judgment,
- respect for licensing and provenance,
- willingness to review other contributors' work,
- care for project users and community standards.

## Governance evolution

This governance model is intentionally simple for the initial public release. If the contributor base expands, the project may introduce documented maintainer roles, voting or consensus rules for major decisions, release ownership, and conflict-resolution procedures.

Governance changes should be proposed publicly whenever security or privacy does not require a private process.
