# Security policy

Cookframe converts recipe sources you point it at into a durable, provider-independent
form. It fetches remote URLs and calls a model provider, so its security posture is part
of the project, not an afterthought.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Security → Report a vulnerability). Do not open a public issue for a
vulnerability.

We aim to acknowledge a report within a few days and to keep you updated as we work on a
fix. Please give us reasonable time to remediate before any public disclosure.

## Secrets

- **No real secret is ever committed.** `.env.example` carries placeholders only; real
  values live in your environment or a secret store and are loaded at run time.
- CI runs a secret scan on every push and pull request. A finding fails the build.
- If you believe a secret was committed, rotate it immediately and report it as above —
  rotation matters more than removing it from history, because anything pushed should be
  assumed captured.

## Fetching remote content

Cookframe fetches source URLs on the server side. Any code that fetches a URL on behalf of
a caller must refuse internal targets — loopback, private-network, and link-local
addresses (SSRF protection). The `url-fetch-security` CI job exists to enforce this
invariant as the fetch layer is built.

## Supply chain

The repository is public and open to contribution. Dependencies are kept minimal, pinned
through the lockfile, and installed with `npm ci` in CI and in the container. Dependency
update automation and branch protection are configured on the repository itself.
