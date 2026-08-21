from pdf_production_engine.job_protocol import validate_job


def test_session_privacy_is_valid_for_ephemeral_orchestrated_job() -> None:
    job = {
        "version": 1,
        "job_id": "session-fixture",
        "stage": "resource",
        "privacy": "session",
        "blocks": [
            {
                "block_id": "asset",
                "kind": "asset",
                "required": True,
                "state": "PENDING_BUILD",
            }
        ],
    }
    assert validate_job(job) == []


def test_unknown_privacy_mode_is_rejected() -> None:
    job = {
        "version": 1,
        "job_id": "bad-privacy",
        "stage": "resource",
        "privacy": "private-repo",
        "blocks": [
            {
                "block_id": "asset",
                "kind": "asset",
                "required": True,
                "state": "PENDING_BUILD",
            }
        ],
    }
    assert "JOB_PRIVACY_INVALID" in validate_job(job)
