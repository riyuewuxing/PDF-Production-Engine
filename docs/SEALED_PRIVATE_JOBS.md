# Sealed private jobs — optional fallback

This protocol is an **optional transport fallback**, not the normal execution path.

The canonical model is session-mediated execution:

`consumer project -> ChatGPT/session -> engine code/runtime -> ChatGPT review -> consumer project`

Use sealed transport only when an environment specifically requires a remote GitHub Actions handoff and private inputs cannot be passed ephemerally by the orchestrator. A missing sealed key must never block ordinary engine use.

## Security model

- Consumer repository and engine repository have no direct credential relationship.
- Plain consumer source is never committed to the public engine.
- The public repository stores at most encrypted job bytes for this optional fallback.
- The runner decrypts only in ephemeral runner storage.
- Results are encrypted before artifact upload.
- ChatGPT/session retrieves, reviews, and writes accepted outputs back to the consumer repository.

## Optional setup

If this fallback is deliberately selected, generate a sealed-box keypair in a trusted environment:

```bash
pdf-sealed keygen
```

Store the private key only in a secure secret store and provide the corresponding public key to the orchestrator through an approved secure operational channel. Do not commit private keys or plaintext consumer inputs.

## Job bundle

The plaintext bundle contains only files needed for one stage plus `engine-run.yaml`. `resource-job.yaml` uses `privacy: sealed` only for this optional route.

The ciphertext may then be processed by `.github/workflows/sealed-resource-job.yml`, which decrypts in runner temporary storage, executes exactly one requested resource block, encrypts the result, uploads only encrypted result bytes, and removes plaintext temporary files.

## Acceptance

Transport choice never changes acceptance rules. Engine output remains `MACHINE_PASS + REVIEW_REQUIRED`; ChatGPT must review real resource pixels and record hash-bound `REVIEW_PASS` in the consumer project before composition or final acceptance.
