from pdf_production_engine.sealed_handoff import generate_keypair, public_from_private


def test_public_key_can_be_derived_from_private_key() -> None:
    public_key, private_key = generate_keypair()
    assert public_from_private(private_key) == public_key
