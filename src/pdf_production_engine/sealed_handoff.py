from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

from nacl.encoding import RawEncoder
from nacl.public import PrivateKey, PublicKey, SealedBox


def _b64e(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64d(value: str) -> bytes:
    padding = "=" * (-len(value.strip()) % 4)
    return base64.urlsafe_b64decode(value.strip() + padding)


def generate_keypair() -> tuple[str, str]:
    private = PrivateKey.generate()
    public = private.public_key
    return _b64e(bytes(public)), _b64e(bytes(private))


def seal_file(public_key_b64: str, source: Path, target: Path) -> None:
    public = PublicKey(_b64d(public_key_b64), encoder=RawEncoder)
    ciphertext = SealedBox(public).encrypt(source.read_bytes())
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(ciphertext)


def unseal_file(private_key_b64: str, source: Path, target: Path) -> None:
    private = PrivateKey(_b64d(private_key_b64), encoder=RawEncoder)
    plaintext = SealedBox(private).decrypt(source.read_bytes())
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(plaintext)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdf-sealed")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("keygen", help="Generate X25519 sealed-box public/private keys")

    p_seal = sub.add_parser("seal")
    p_seal.add_argument("--public-key", required=True)
    p_seal.add_argument("--input", type=Path, required=True)
    p_seal.add_argument("--output", type=Path, required=True)

    p_unseal = sub.add_parser("unseal")
    p_unseal.add_argument("--private-key", required=True)
    p_unseal.add_argument("--input", type=Path, required=True)
    p_unseal.add_argument("--output", type=Path, required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "keygen":
            public, private = generate_keypair()
            print(f"PUBLIC_KEY={public}")
            print(f"PRIVATE_KEY={private}")
            print("Store PRIVATE_KEY only in a secure secret store; commit/share only PUBLIC_KEY.")
        elif args.command == "seal":
            seal_file(args.public_key, args.input, args.output)
            print(f"SEALED_OK bytes={args.output.stat().st_size}")
        elif args.command == "unseal":
            unseal_file(args.private_key, args.input, args.output)
            print(f"UNSEALED_OK bytes={args.output.stat().st_size}")
        return 0
    except Exception as exc:
        print(f"SEALED_HANDOFF_FAIL: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
