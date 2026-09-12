from __future__ import annotations

import argparse
import base64
import hashlib
import os
import sys
from pathlib import Path

from nacl.bindings import (
    crypto_aead_chacha20poly1305_ietf_decrypt,
    crypto_aead_chacha20poly1305_ietf_encrypt,
    crypto_scalarmult,
)
from nacl.public import PrivateKey, PublicKey

MAGIC = b"PESH-v1\x00"
NONCE_BYTES = 12
PUB_BYTES = 32
KEY_BYTES = 32
CONTEXT = b"PDF_ENGINE_SESSION_HANDOFF_V1"


def _b64e(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64d(value: str) -> bytes:
    padding = "=" * (-len(value.strip()) % 4)
    return base64.urlsafe_b64decode(value.strip() + padding)


def generate_keypair() -> tuple[str, str]:
    private = PrivateKey.generate()
    return _b64e(bytes(private.public_key)), _b64e(bytes(private))


def public_from_private(private_key_b64: str) -> str:
    private = PrivateKey(_b64d(private_key_b64))
    return _b64e(bytes(private.public_key))


def _derive(shared: bytes, ephemeral_public: bytes, recipient_public: bytes) -> bytes:
    return hashlib.blake2b(
        CONTEXT + shared + ephemeral_public + recipient_public,
        digest_size=KEY_BYTES,
    ).digest()


def seal_bytes(public_key_b64: str, plaintext: bytes, request_id: str) -> bytes:
    recipient_public = _b64d(public_key_b64)
    if len(recipient_public) != PUB_BYTES:
        raise ValueError("recipient public key must be 32 raw bytes")
    ephemeral = PrivateKey.generate()
    ephemeral_public = bytes(ephemeral.public_key)
    shared = crypto_scalarmult(bytes(ephemeral), recipient_public)
    key = _derive(shared, ephemeral_public, recipient_public)
    nonce = os.urandom(NONCE_BYTES)
    ciphertext = crypto_aead_chacha20poly1305_ietf_encrypt(
        plaintext,
        request_id.encode("utf-8"),
        nonce,
        key,
    )
    return MAGIC + ephemeral_public + nonce + ciphertext


def unseal_bytes(private_key_b64: str, envelope: bytes, request_id: str) -> bytes:
    if not envelope.startswith(MAGIC):
        raise ValueError("session envelope magic/version mismatch")
    offset = len(MAGIC)
    if len(envelope) < offset + PUB_BYTES + NONCE_BYTES + 16:
        raise ValueError("session envelope truncated")
    ephemeral_public = envelope[offset : offset + PUB_BYTES]
    offset += PUB_BYTES
    nonce = envelope[offset : offset + NONCE_BYTES]
    ciphertext = envelope[offset + NONCE_BYTES :]

    private_raw = _b64d(private_key_b64)
    if len(private_raw) != PUB_BYTES:
        raise ValueError("recipient private key must be 32 raw bytes")
    private = PrivateKey(private_raw)
    recipient_public = bytes(private.public_key)
    shared = crypto_scalarmult(private_raw, ephemeral_public)
    key = _derive(shared, ephemeral_public, recipient_public)
    return crypto_aead_chacha20poly1305_ietf_decrypt(
        ciphertext,
        request_id.encode("utf-8"),
        nonce,
        key,
    )


def seal_file(public_key_b64: str, source: Path, target: Path, request_id: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(seal_bytes(public_key_b64, source.read_bytes(), request_id))


def unseal_file(private_key_b64: str, source: Path, target: Path, request_id: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(unseal_bytes(private_key_b64, source.read_bytes(), request_id))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdf-session")
    sub = parser.add_subparsers(dest="command", required=True)

    p_keygen = sub.add_parser("keygen")
    p_keygen.add_argument("--private-out", type=Path, required=True)
    p_keygen.add_argument("--public-out", type=Path, required=True)

    p_seal = sub.add_parser("seal")
    p_seal.add_argument("--public-key", required=True)
    p_seal.add_argument("--request-id", required=True)
    p_seal.add_argument("--input", type=Path, required=True)
    p_seal.add_argument("--output", type=Path, required=True)

    p_unseal = sub.add_parser("unseal")
    p_unseal.add_argument("--private-key", required=True)
    p_unseal.add_argument("--request-id", required=True)
    p_unseal.add_argument("--input", type=Path, required=True)
    p_unseal.add_argument("--output", type=Path, required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "keygen":
            public, private = generate_keypair()
            args.private_out.parent.mkdir(parents=True, exist_ok=True)
            args.public_out.parent.mkdir(parents=True, exist_ok=True)
            args.private_out.write_text(private + "\n", encoding="ascii")
            args.public_out.write_text(public + "\n", encoding="ascii")
            print(f"SESSION_PUBLIC_KEY={public}")
            return 0
        if args.command == "seal":
            seal_file(args.public_key, args.input, args.output, args.request_id)
            print(f"SESSION_SEALED_OK bytes={args.output.stat().st_size}")
            return 0
        if args.command == "unseal":
            unseal_file(args.private_key, args.input, args.output, args.request_id)
            print(f"SESSION_UNSEALED_OK bytes={args.output.stat().st_size}")
            return 0
        return 2
    except Exception as exc:
        print(f"SESSION_HANDOFF_FAIL: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
