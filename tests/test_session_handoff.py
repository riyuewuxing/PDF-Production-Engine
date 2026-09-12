from __future__ import annotations

import pytest

from pdf_production_engine.session_handoff import (
    generate_keypair,
    seal_bytes,
    unseal_bytes,
)


def test_session_handoff_roundtrip_and_request_binding() -> None:
    public, private = generate_keypair()
    payload = b"private build package bytes\x00\x01"
    envelope = seal_bytes(public, payload, "req-123")

    assert payload not in envelope
    assert unseal_bytes(private, envelope, "req-123") == payload

    with pytest.raises(Exception):
        unseal_bytes(private, envelope, "req-other")


def test_session_handoff_tamper_fails_closed() -> None:
    public, private = generate_keypair()
    envelope = bytearray(seal_bytes(public, b"payload", "req-456"))
    envelope[-1] ^= 1

    with pytest.raises(Exception):
        unseal_bytes(private, bytes(envelope), "req-456")
