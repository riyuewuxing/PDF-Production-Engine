# Sealed private jobs

This protocol is the privacy-preserving path for consumer projects that must use the public engine without granting the engine any repository token.

## Security model

- Consumer repository and engine repository have no direct credential relationship.
- Plain consumer source is never committed to the public engine.
- The public repository stores at most an encrypted `input.sealed` payload plus a non-secret one-time return public key.
- The runner decrypts only in ephemeral runner storage.
- Detailed consumer command stdout/stderr remains inside the encrypted output bundle.
- Result artifacts are encrypted before `upload-artifact`.
- ChatGPT/session retrieves and decrypts the result, reviews it, and writes accepted outputs back to the consumer repository.

## One-time engine key setup

Generate a sealed-box keypair in a trusted environment:

```bash
pdf-sealed keygen
```

Store **only** `PRIVATE_KEY` as the GitHub Actions repository secret:

`ENGINE_SEALED_PRIVATE_KEY`

Never commit the private key, put it in a workflow file, issue, PR, artifact, log, commit status, repository variable or consumer package.

The matching public key is safe to share because it can encrypt but cannot decrypt. The engine provides an owner-only bootstrap workflow:

`.github/workflows/sealed-key-bootstrap.yml`

It reads the secret, derives only the public key, and publishes these commit-status signals:

- `pdf-engine/sealed-key/bootstrap-started=success` — workflow reached key derivation;
- `pdf-engine/sealed-key/missing-secret=error` — secret is absent;
- `pdf-engine/sealed-key/derive-failed=error` — configured secret cannot be parsed;
- `pdf-engine/sealed-key=success` — a public key was derived;
- `pdf-engine/sealed-key/<PUBLIC_KEY>=success` — machine-readable public key for ChatGPT/orchestrators.

A real private consumer job must not be submitted until the machine-readable public-key status exists. `pdf-engine/ci=success` by itself does not prove private sealed transport is configured.

## Per-job return key

For each private job, ChatGPT/session generates a new one-time keypair. Only the one-time public key is put in `.engine-job/return-public-key.txt`. The one-time private key stays in the session until the encrypted result is retrieved and decrypted.

## Job bundle

The plaintext bundle is a ZIP containing only the files needed for one stage plus:

`engine-run.yaml`

Example:

```yaml
version: 1
job_file: resource-job.yaml
block_id: figures
dpi: 144
```

`resource-job.yaml` follows `schemas/resource-job-v1.yaml` and must use `privacy: sealed`.

For immutable public PDF source pages, a sealed stage package may use `pdf-locked-pages` with a package-local `locked-source.yaml`. That generic primitive validates declared source identity and extracts declared physical pages; it never decides whether those pages are the correct business/domain pages and still returns `REVIEW_REQUIRED`.

The bundle is encrypted with the engine public key:

```bash
pdf-sealed seal \
  --public-key "$ENGINE_PUBLIC_KEY" \
  --input input.zip \
  --output input.sealed
```

Only the ciphertext is submitted to an owner-controlled `job/**` branch.

## Runner

`.github/workflows/sealed-resource-job.yml`:

1. runs only for owner pushes on `job/**`;
2. checks out the public engine/job ciphertext;
3. installs the generic document/figure runtime;
4. decrypts `input.sealed` in runner temp storage using `ENGINE_SEALED_PRIVATE_KEY`;
5. validates the resource job and review prerequisites;
6. executes exactly the requested block with `pdf-resource-run`;
7. zips the output/evidence;
8. encrypts the result to the one-time return public key;
9. uploads only encrypted result bytes;
10. deletes plaintext temp files.

## Review/composition loop

A private composite document therefore takes multiple resource jobs:

1. ChatGPT accepts content in the consumer repo;
2. submit figure/resource block job;
3. retrieve/decrypt/render evidence;
4. ChatGPT records hash-bound `REVIEW_PASS` in consumer repo;
5. repeat for required source-page/chart/image blocks;
6. submit composition job carrying the current receipts;
7. retrieve/decrypt final PDF and page renders;
8. ChatGPT performs final page-by-page acceptance and writes accepted PDF/evidence into the consumer repository.

The engine remains stateless across these runs; the consumer repository stores the authoritative receipts.
