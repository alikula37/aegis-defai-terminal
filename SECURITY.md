# Security Policy

## Supported Versions

The project is pre-1.0 (active development). Security fixes are applied to the
latest commit on `main`; no LTS backports are provided yet.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security problems.** Instead:

- Open a **private advisory** on GitHub:
  `https://github.com/<owner>/<repo>/security/advisories/new`
- Or email the maintainers (address published on the repository profile).

Include:

1. A description of the vulnerability and its impact (what an attacker can do).
2. Steps to reproduce (minimal example or request trace).
3. Affected endpoints/modules (`server.js`, `utils/auth.js`, `db/database.js`, …).
4. Suggested fix, if you have one.

We aim to acknowledge reports within 3 business days and ship a fix on `main`
as soon as it is verified.

## Security model (summary)

- **Auth:** server-side sessions (`utils/auth.js`), scrypt password hashing,
  per-account lockout, Origin-based CSRF defense — see `docs/AUTH.md`.
- **Secrets:** encrypted at rest (AES-256-CBC, `ENCRYPTION_KEY`), never logged,
  masked in API responses; `.env` is git-ignored.
- **Execution:** on-chain trades are fail-closed by default; mainnet broadcast
  requires an explicit `ALLOW_MAINNET_LIVE=true` opt-in.
- **Reporting a vulnerability in dependencies:** use
  [GitHub Dependabot alerts](https://docs.github.com/en/code-security/dependabot)
  on the repository.
