"""Opt-in StudioNet lifecycle smoke test for the public GitHub evidence interface."""

import hashlib
import json
import os

import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionStatus


def canonical_config(task_id, worker, repository_url, title, checklist, escrow_wei):
    lines = [
        "# Public Docket agreement configuration. Keep this file unchanged after registration.",
        "version: 2",
        f"task_id: {task_id}",
        f"repository_url: {repository_url}",
        f"worker_address: {str(worker).lower()}",
        f"title: {json.dumps(title, ensure_ascii=True)}",
        f"escrow_wei: {json.dumps(str(escrow_wei), ensure_ascii=True)}",
        "",
        "criteria:",
    ]
    for criterion in json.loads(checklist):
        lines.extend([
            f"  - id: {criterion['id']}",
            f"    weight_bps: {criterion['weight_bps']}",
            f"    description: {json.dumps(criterion['description'], ensure_ascii=True)}",
        ])
    lines.extend([
        "",
        "github:",
        "  provider: github",
        "  public_only: true",
        "  config_path: docket.yml",
    ])
    return "\n".join(lines) + "\n"


@pytest.mark.integration
def test_register_submit_open_dispute_flow(default_account, accounts):
    repository_url = os.getenv("DOCKET_STUDIONET_PUBLIC_REPOSITORY", "").strip()
    if not repository_url:
        pytest.skip(
            "Set DOCKET_STUDIONET_PUBLIC_REPOSITORY to a real active public GitHub repository "
            "to opt into this network-writing smoke test."
        )
    requester = default_account
    worker = next((account for account in accounts if account.address != requester.address), None)
    if worker is None:
        pytest.skip("StudioNet smoke test requires a second configured worker account")

    task_id = "dkt-studionet-rate-limiter-20260909"
    title = "Rate limiter delivery"
    escrow_wei = 10_000
    checklist = json.dumps([
        {"id": "behavior", "description": "The endpoint enforces the configured request quota.", "weight_bps": 5000},
        {"id": "tests", "description": "Automated tests cover rejection and quota reset.", "weight_bps": 5000},
    ])
    config_sha256 = hashlib.sha256(
        canonical_config(
            task_id, worker.address, repository_url, title, checklist, escrow_wei
        ).encode("utf-8")
    ).hexdigest()

    factory = get_contract_factory(contract_name="Docket")
    contract = factory.deploy(
        account=requester,
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    created = contract.register_task(
        args=[
            task_id,
            worker.address,
            repository_url,
            title,
            checklist,
            config_sha256,
        ]
    ).transact(value=escrow_wei, wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(created)

    evidence_manifest = json.dumps({
        "pr_url": f"{repository_url}/pull/42",
        "head_sha": "a" * 40,
        "actions_run_url": f"{repository_url}/actions/runs/77",
    })
    submitted = contract.connect(worker).submit_delivery(
        args=[task_id, evidence_manifest]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(submitted)

    disputed = contract.open_dispute(
        args=[task_id, "The reset test does not cover the documented sixty-second boundary."]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(disputed)

    task = contract.get_task(args=[task_id]).call()
    assert task["status"] == "DISPUTED"
    assert task["repository_url"] == repository_url
    assert task["config_sha256"] == config_sha256
    assert task["evidence_manifest"]["head_sha"] == "a" * 40
