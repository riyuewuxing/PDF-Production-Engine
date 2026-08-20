# Deterministic build fixture

This document exists only to test the public PDF engine.

## Required guarantees

- build from an explicit manifest
- open and preflight the generated PDF
- render every page to PNG
- calculate SHA-256 for the PDF and rendered pages
- emit a machine-readable build manifest
- never treat render success as human visual acceptance

---

中文验收句：PDF 构建成功不等于视觉验收通过。
