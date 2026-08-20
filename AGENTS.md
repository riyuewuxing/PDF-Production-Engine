# AGENTS.md — PDF Production Engine

## Purpose

This public repository is a deterministic PDF production engine. It owns generic build orchestration, PDF preflight, full-page rendering, machine evidence, and trusted cross-repository delivery. It does not own consumer-project business content.

## Hard boundaries

1. Never commit private consumer source, private PDFs, credentials, cookies, or tokens to this public repository.
2. Public CI may only build public fixtures contained in this repository.
3. Private-project builds must use an owner-triggered workflow, a least-privilege repository token, temporary runner storage, and direct write-back to the private repository. Do not upload private build outputs as public workflow artifacts.
4. No `pull_request_target` execution of consumer code. Pull requests only run public fixture/unit tests.
5. The engine may execute a consumer manifest command only from an explicitly trusted owner-triggered private build.
6. PDF build success is not visual acceptance. Every successful build must render every page and record `HUMAN_PIXEL_CONFIRMATION_REQUIRED`.
7. A PDF is accepted by the engine only after open/preflight, positive page count, full-page render count equality, SHA-256 generation, and manifest creation.
8. Consumer-project rules/content remain authoritative in the consumer repository. This engine must not invent or rewrite business content.

## Canonical CLI

```bash
pdf-production build --root <project-root> --manifest <manifest-relative-to-root> --out <output-root>
```

## Branch discipline

Develop on feature branches. Do not merge to `main` or create PRs unless explicitly authorized.
