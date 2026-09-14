import hashlib
import json


REPOSITORY_URL = "https://github.com/acme/rate-limiter"
TASK_ID = "dkt-rate-limiter-20260909"
HEAD_SHA = "a" * 40
NEXT_HEAD_SHA = "b" * 40
TITLE = "Ship a production rate limiter"

CHECKLIST = json.dumps([
    {"id": "rate-limit", "description": "Reject the sixth request inside sixty seconds.", "weight_bps": 2000},
    {"id": "headers", "description": "Return retry and remaining quota headers.", "weight_bps": 2000},
    {"id": "isolation", "description": "Track limits independently for every API key.", "weight_bps": 2000},
    {"id": "tests", "description": "Include automated tests for quota reset behavior.", "weight_bps": 2000},
    {"id": "docs", "description": "Document configuration and failure responses.", "weight_bps": 2000},
])


def canonical_config_text(
    task_id,
    worker,
    repository_url=REPOSITORY_URL,
    title=TITLE,
    checklist=CHECKLIST,
    value=10_000,
):
    from genlayer import Address

    address = str(worker if isinstance(worker, Address) else Address(worker)).lower()
    lines = [
        "# Public Docket agreement configuration. Keep this file unchanged after registration.",
        "version: 2",
        f"task_id: {task_id}",
        f"repository_url: {repository_url}",
        f"worker_address: {address}",
        f"title: {json.dumps(title, ensure_ascii=True)}",
        f"escrow_wei: {json.dumps(str(value), ensure_ascii=True)}",
        "",
        "criteria:",
    ]
    for criterion in json.loads(checklist):
        lines.append(f"  - id: {criterion['id']}")
        lines.append(f"    weight_bps: {criterion['weight_bps']}")
        lines.append(
            f"    description: {json.dumps(criterion['description'], ensure_ascii=True)}"
        )
    lines.extend([
        "",
        "github:",
        "  provider: github",
        "  public_only: true",
        "  config_path: docket.yml",
    ])
    return "\n".join(lines) + "\n"


def config_sha256_for(*args, **kwargs):
    return hashlib.sha256(canonical_config_text(*args, **kwargs).encode("utf-8")).hexdigest()


def mock_public_repository(direct_vm, repository_url=REPOSITORY_URL):
    repository_slug = repository_url.removeprefix("https://github.com/")
    direct_vm.mock_web(
        rf"https://api\.github\.com/repos/{repository_slug}$",
        {
            "status": 200,
            "body": json.dumps({
                "full_name": repository_slug,
                "private": False,
                "archived": False,
                "disabled": False,
            }),
        },
    )


def manifest(head_sha=HEAD_SHA, repository_url=REPOSITORY_URL, pr_number=42, run_id=77):
    return json.dumps({
        "pr_url": f"{repository_url}/pull/{pr_number}",
        "head_sha": head_sha,
        "actions_run_url": f"{repository_url}/actions/runs/{run_id}",
    })


def register(
    contract,
    direct_vm,
    requester,
    worker,
    task_id=TASK_ID,
    value=10_000,
    config_sha256=None,
):
    from genlayer import Address

    expected_config = canonical_config_text(task_id, worker, value=value)
    expected_hash = hashlib.sha256(expected_config.encode("utf-8")).hexdigest()
    mock_public_repository(direct_vm)
    direct_vm.docket_config_text = expected_config
    direct_vm.docket_config_sha256 = expected_hash
    direct_vm.sender = requester
    direct_vm.value = value
    registered_task_id = contract.register_task(
        task_id,
        Address(worker),
        REPOSITORY_URL,
        TITLE,
        CHECKLIST,
        config_sha256 or expected_hash,
    )
    direct_vm.value = 0
    return registered_task_id


def submit_and_dispute(contract, direct_vm, requester, worker, evidence_manifest=None):
    task_id = register(contract, direct_vm, requester, worker)
    direct_vm.sender = worker
    contract.submit_delivery(task_id, evidence_manifest or manifest())
    direct_vm.sender = requester
    contract.open_dispute(task_id, "API-key isolation fails under the supplied concurrency reproduction.")
    return task_id


def mock_github_evidence(
    direct_vm,
    head_sha=HEAD_SHA,
    workflow_head_sha=None,
    workflow_status="completed",
    workflow_conclusion="success",
    workflow_event="pull_request",
    workflow_pr_numbers=None,
    workflow_attempt=1,
    base_full_name="acme/rate-limiter",
    run_full_name="acme/rate-limiter",
    head_full_name="acme/rate-limiter",
    head_private=False,
    config_text=None,
    config_head_sha=HEAD_SHA,
):
    if config_text is None:
        config_text = getattr(direct_vm, "docket_config_text", "")
    if workflow_pr_numbers is None:
        workflow_pr_numbers = [42]
    direct_vm.mock_web(
        r"https://api\.github\.com/repos/acme/rate-limiter/pulls/42$",
        {
            "status": 200,
            "body": json.dumps({
                "state": "closed",
                "merged": False,
                "head": {
                    "sha": head_sha,
                    "repo": {"full_name": head_full_name, "private": head_private},
                },
                "base": {"repo": {"full_name": base_full_name, "private": False}},
                "changed_files": 3,
            }),
        },
    )
    direct_vm.mock_web(
        r"https://api\.github\.com/repos/acme/rate-limiter/pulls/42/files\?per_page=5&page=1",
        {
            "status": 200,
            "body": json.dumps([
                {
                    "filename": "docs/rate-limiter.md",
                    "status": "modified",
                    "additions": 3,
                    "deletions": 0,
                    "patch": "@@ -1 +1,4 @@\n+Rate limit configuration and error behavior.\n",
                },
                {
                    "filename": "src/limiter.py",
                    "status": "modified",
                    "additions": 18,
                    "deletions": 2,
                    "patch": "@@ -20 +20,8 @@\n+if request_count > 5:\n+    return quota_error()\n",
                },
                {
                    "filename": "tests/test_limiter.py",
                    "status": "added",
                    "additions": 12,
                    "deletions": 0,
                    "patch": "@@ -0,0 +1,12 @@\n+def test_quota_reset():\n+    assert retry_after == 60\n",
                },
            ]),
        },
    )
    direct_vm.mock_web(
        r"https://api\.github\.com/repos/acme/rate-limiter/actions/runs/77$",
        {
            "status": 200,
            "body": json.dumps({
                "head_sha": workflow_head_sha or head_sha,
                "event": workflow_event,
                "pull_requests": [{"number": number} for number in workflow_pr_numbers],
                "run_attempt": workflow_attempt,
                "status": workflow_status,
                "conclusion": workflow_conclusion,
                "repository": {"full_name": run_full_name, "private": False},
            }),
        },
    )
    direct_vm.mock_web(
        rf"https://raw\.githubusercontent\.com/{head_full_name}/{config_head_sha}/docket\.yml$",
        {
            "status": 200,
            "body": config_text,
        },
    )


def partial_findings():
    return json.dumps({"findings": [
        {"id": "rate-limit", "verdict": "PASS", "reason": "The sixth request is rejected."},
        {"id": "headers", "verdict": "PASS", "reason": "Required headers are present."},
        {"id": "isolation", "verdict": "FAIL", "reason": "Concurrent keys share quota state."},
        {"id": "tests", "verdict": "PASS", "reason": "Reset behavior is covered."},
        {"id": "docs", "verdict": "PASS", "reason": "Configuration is documented."},
    ]})


def capture_external_messages(direct_vm, callback):
    emitted = []
    prior_hook = direct_vm._gl_call_hook

    def capture(vm, request):
        if isinstance(request, dict) and (
            "PostMessage" in request or "EthSend" in request
        ):
            emitted.append(request)
            return {"ok": None}
        if prior_hook is not None:
            return prior_hook(vm, request)
        return None

    direct_vm._gl_call_hook = capture
    try:
        callback()
    finally:
        direct_vm._gl_call_hook = prior_hook
    return emitted


def assert_eth_sends(emitted, expected_payments):
    """The direct VM exposes an external transfer as its EthSend envelope."""
    from genlayer import Address

    assert len(emitted) == len(expected_payments)
    actual_payments = []
    for message in emitted:
        assert set(message) == {"EthSend"}
        payload = message["EthSend"]
        assert payload["calldata"] == b""
        actual_payments.append((str(payload["address"]).lower(), int(payload["value"])))
    assert actual_payments == [
        (str(Address(address)).lower(), amount) for address, amount in expected_payments
    ]


def test_registers_a_client_supplied_funded_task_bound_to_repository_and_configuration(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    direct_vm.check_pickling = True
    contract = direct_deploy("contracts/docket.py")
    task_id = register(contract, direct_vm, direct_alice, direct_bob)

    task = contract.get_task(task_id)
    assert task["id"] == TASK_ID
    assert task["status"] == "OPEN"
    assert task["escrow_amount"] == 10_000
    assert task["repository_url"] == REPOSITORY_URL
    assert task["repository_slug"] == "acme/rate-limiter"
    assert task["config_sha256"] == direct_vm.docket_config_sha256
    assert task["evidence_manifest"] == {}
    assert task["evidence_snapshot"] == {}
    assert sum(item["weight_bps"] for item in task["checklist"]) == 10_000


def test_rejects_duplicate_or_malformed_task_ids(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    register(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_alice
    direct_vm.value = 10_000
    from genlayer import Address

    with direct_vm.expect_revert("Task id is already registered"):
        contract.register_task(
            TASK_ID,
            Address(direct_bob),
            REPOSITORY_URL,
            "Duplicate task",
            CHECKLIST,
            "0" * 64,
        )
    with direct_vm.expect_revert("Task id must be a valid dkt- identifier"):
        contract.register_task(
            "docket-unsafe",
            Address(direct_bob),
            REPOSITORY_URL,
            "Bad task identifier",
            CHECKLIST,
            "0" * 64,
        )


def test_rejects_noncanonical_repository_or_malformed_weight_total(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    from genlayer import Address

    direct_vm.sender = direct_alice
    direct_vm.value = 10_000
    with direct_vm.expect_revert("Repository URL"):
        contract.register_task(
            "dkt-noncanonical-repository",
            Address(direct_bob),
            "https://github.com/acme/rate-limiter/",
            "Noncanonical repository",
            CHECKLIST,
            "0" * 64,
        )

    invalid = json.dumps([
        {"id": "one", "description": "First measurable acceptance criterion.", "weight_bps": 4000},
        {"id": "two", "description": "Second measurable acceptance criterion.", "weight_bps": 4000},
    ])
    with direct_vm.expect_revert("Criterion weights must total 10000 basis points"):
        contract.register_task(
            "dkt-invalid-weight-total",
            Address(direct_bob),
            REPOSITORY_URL,
            "Invalid weighted task",
            invalid,
            "0" * 64,
        )


def test_rejects_noncanonical_configuration_hashes(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    from genlayer import Address

    direct_vm.sender = direct_alice
    direct_vm.value = 10_000
    for index, invalid_hash in enumerate([
        "",
        "c" * 63,
        "C" * 64,
        "g" * 64,
        "0x" + ("c" * 64),
        ("c" * 64) + " ",
    ]):
        with direct_vm.expect_revert("Configuration hash must match the canonical v2 docket.yml"):
            contract.register_task(
                f"dkt-invalid-config-hash-{index}",
                Address(direct_bob),
                REPOSITORY_URL,
                "Invalid configuration hash",
                CHECKLIST,
                invalid_hash,
            )


def test_registration_rejects_a_valid_hash_for_different_public_terms(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy("contracts/docket.py")
    from genlayer import Address

    expected_hash = config_sha256_for(TASK_ID, direct_bob)
    direct_vm.sender = direct_alice
    direct_vm.value = 10_000
    with direct_vm.expect_revert("Configuration hash must match the canonical v2 docket.yml"):
        contract.register_task(
            TASK_ID,
            Address(direct_bob),
            REPOSITORY_URL,
            "A different delivery title",
            CHECKLIST,
            expected_hash,
        )

    direct_vm.value = 10_001
    with direct_vm.expect_revert("Configuration hash must match the canonical v2 docket.yml"):
        contract.register_task(
            "dkt-nonround-escrow-20260909",
            Address(direct_charlie),
            REPOSITORY_URL,
            TITLE,
            CHECKLIST,
            expected_hash,
        )


def test_registration_requires_a_nonzero_worker_and_reachable_public_repository(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    from genlayer import Address

    direct_vm.sender = direct_alice
    direct_vm.value = 10_000
    zero_address = Address("0x" + ("0" * 40))
    zero_hash = config_sha256_for("dkt-zero-worker-20260909", zero_address)
    with direct_vm.expect_revert("Worker must be a non-zero"):
        contract.register_task(
            "dkt-zero-worker-20260909",
            zero_address,
            REPOSITORY_URL,
            TITLE,
            CHECKLIST,
            zero_hash,
        )

    unavailable_repository = "https://github.com/acme/not-public"
    unavailable_task_id = "dkt-unavailable-repository-20260909"
    unavailable_hash = config_sha256_for(
        unavailable_task_id,
        direct_bob,
        repository_url=unavailable_repository,
    )
    direct_vm.mock_web(
        r"https://api\.github\.com/repos/acme/not-public$",
        {"status": 404, "body": json.dumps({"message": "Not Found"})},
    )
    with direct_vm.expect_revert("Repository must be a reachable, active public GitHub repository"):
        contract.register_task(
            unavailable_task_id,
            Address(direct_bob),
            unavailable_repository,
            TITLE,
            CHECKLIST,
            unavailable_hash,
        )


def test_worker_submits_a_bound_github_manifest_and_requester_opens_dispute(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = register(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_bob
    contract.submit_delivery(task_id, manifest())
    submitted = contract.get_task(task_id)
    assert submitted["status"] == "SUBMITTED"
    assert submitted["evidence_manifest"]["head_sha"] == HEAD_SHA
    assert submitted["evidence_manifest"]["pr_number"] == "42"
    assert submitted["evidence_manifest"]["run_id"] == "77"

    direct_vm.sender = direct_alice
    contract.open_dispute(task_id, "Quota isolation fails when two API keys send requests concurrently.")
    assert contract.get_task(task_id)["status"] == "DISPUTED"


def test_requester_acceptance_emits_an_external_payout(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = register(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(task_id, manifest())
    direct_vm.sender = direct_alice

    emitted = capture_external_messages(
        direct_vm,
        lambda: contract.accept_delivery(task_id),
    )

    assert_eth_sends(emitted, [(direct_bob, 10_000)])


def test_cancelled_task_emits_an_external_refund(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = register(contract, direct_vm, direct_alice, direct_bob)

    emitted = capture_external_messages(
        direct_vm,
        lambda: contract.cancel_task(task_id),
    )

    assert contract.get_task(task_id)["status"] == "CANCELLED"
    assert_eth_sends(emitted, [(direct_alice, 10_000)])


def test_rejects_nonworker_and_other_repository_manifests(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy("contracts/docket.py")
    task_id = register(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only the worker can submit a GitHub evidence manifest"):
        contract.submit_delivery(task_id, manifest())

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("PR URL must belong to the task repository"):
        contract.submit_delivery(
            task_id,
            manifest(repository_url="https://github.com/other/repository"),
        )
    private_style_manifest = json.loads(manifest())
    private_style_manifest["pr_url"] = f"{REPOSITORY_URL}/pull/42?access_token=secret"
    with direct_vm.expect_revert("canonical positive pull request number"):
        contract.submit_delivery(task_id, json.dumps(private_style_manifest))
    free_text_manifest = json.loads(manifest())
    free_text_manifest["summary"] = "Do not persist arbitrary delivery prose."
    with direct_vm.expect_revert("Evidence manifest must contain exactly"):
        contract.submit_delivery(task_id, json.dumps(free_text_manifest))
    bound_config_manifest = json.loads(manifest())
    bound_config_manifest["config_sha256"] = direct_vm.docket_config_sha256
    with direct_vm.expect_revert("Evidence manifest must contain exactly"):
        contract.submit_delivery(task_id, json.dumps(bound_config_manifest))


def test_worker_can_escalate_an_unreviewed_github_submission(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = register(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(task_id, manifest())
    with direct_vm.expect_revert("Worker escalation is available 24 hours after submission"):
        contract.escalate_submission(
            task_id,
            "The submission remains unreviewed, so the worker requests validator resolution.",
        )
    direct_vm.warp("2030-01-01T00:00:00Z")
    contract.escalate_submission(
        task_id,
        "The submission remains unreviewed, so the worker requests validator resolution.",
    )
    assert contract.get_task(task_id)["status"] == "DISPUTED"


def test_partial_resolution_uses_github_api_facts_and_records_eighty_twenty_split(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    mock_github_evidence(direct_vm)
    direct_vm.mock_llm(r".*neutral settlement validator.*", partial_findings())

    result = contract.resolve_dispute(task_id)
    task = contract.get_task(task_id)

    assert direct_vm.run_validator() is True
    assert result["passed_bps"] == 8000
    assert task["status"] == "RESOLVED"
    assert task["worker_amount"] == 8000
    assert task["requester_amount"] == 2000
    assert task["evidence_snapshot"]["verification_status"] == "VERIFIED"
    assert task["evidence_snapshot"]["head_sha"] == HEAD_SHA
    assert task["evidence_snapshot"]["workflow_conclusion"] == "success"
    assert task["evidence_snapshot"]["relationships"]["config_at_head_matches_registration"] is True
    assert [item["filename"] for item in task["evidence_snapshot"]["changed_files"]] == [
        "docs/rate-limiter.md",
        "src/limiter.py",
        "tests/test_limiter.py",
    ]
    assert "request_count > 5" in task["evidence_snapshot"]["changed_files"][1]["patch_excerpt"]


def test_partial_resolution_emits_the_two_proportional_external_payouts(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    mock_github_evidence(direct_vm)
    direct_vm.mock_llm(r".*neutral settlement validator.*", partial_findings())

    emitted = capture_external_messages(
        direct_vm,
        lambda: contract.resolve_dispute(task_id),
    )

    assert direct_vm.run_validator() is True
    assert_eth_sends(emitted, [(direct_bob, 8_000), (direct_alice, 2_000)])


def test_github_api_failure_is_explicitly_inconclusive_and_never_pays(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.mock_web(
        r"https://api\.github\.com/repos/acme/rate-limiter/pulls/42$",
        {"status": 503, "body": json.dumps({"message": "Service unavailable"})},
    )

    result = contract.resolve_dispute(task_id)
    task = contract.get_task(task_id)
    assert result["status"] == "NEEDS_EVIDENCE"
    assert task["status"] == "NEEDS_EVIDENCE"
    assert task["worker_amount"] == 0
    assert task["requester_amount"] == 0
    assert task["evidence_snapshot"]["verification_status"] == "GITHUB_API_UNAVAILABLE"
    assert all(finding["verdict"] == "INCONCLUSIVE" for finding in task["findings"])


def test_manifest_head_or_workflow_relationship_mismatch_is_inconclusive(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    mock_github_evidence(direct_vm, head_sha=NEXT_HEAD_SHA)

    result = contract.resolve_dispute(task_id)
    task = contract.get_task(task_id)
    assert result["status"] == "NEEDS_EVIDENCE"
    assert task["evidence_snapshot"]["verification_status"] == "MANIFEST_MISMATCH"
    assert task["evidence_snapshot"]["relationships"]["manifest_head_matches_pr"] is False
    assert task["worker_amount"] == 0
    assert task["requester_amount"] == 0


def test_workflow_run_must_reference_the_same_public_pr_head(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    mock_github_evidence(direct_vm, workflow_head_sha=NEXT_HEAD_SHA)

    result = contract.resolve_dispute(task_id)
    task = contract.get_task(task_id)
    assert result["status"] == "NEEDS_EVIDENCE"
    assert task["evidence_snapshot"]["verification_status"] == "MANIFEST_MISMATCH"
    assert task["evidence_snapshot"]["relationships"]["workflow_head_matches_pr"] is False
    assert task["worker_amount"] == 0
    assert task["requester_amount"] == 0


def test_workflow_run_must_be_a_successful_pull_request_run_for_that_pr(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    mock_github_evidence(direct_vm, workflow_event="push")

    result = contract.resolve_dispute(task_id)
    task = contract.get_task(task_id)
    assert result["status"] == "NEEDS_EVIDENCE"
    assert task["evidence_snapshot"]["verification_status"] == "MANIFEST_MISMATCH"
    assert task["evidence_snapshot"]["relationships"]["workflow_is_pull_request_event"] is False


def test_workflow_run_must_link_to_the_submitted_pull_request(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    mock_github_evidence(direct_vm, workflow_pr_numbers=[41])

    result = contract.resolve_dispute(task_id)
    task = contract.get_task(task_id)
    assert result["status"] == "NEEDS_EVIDENCE"
    assert task["evidence_snapshot"]["verification_status"] == "MANIFEST_MISMATCH"
    assert task["evidence_snapshot"]["relationships"]["workflow_links_to_manifest_pr"] is False


def test_config_at_delivery_head_must_match_the_registered_configuration(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    mock_github_evidence(
        direct_vm,
        config_text=direct_vm.docket_config_text + "# changed after task registration\n",
    )

    result = contract.resolve_dispute(task_id)
    task = contract.get_task(task_id)

    assert result["status"] == "NEEDS_EVIDENCE"
    assert task["status"] == "NEEDS_EVIDENCE"
    assert task["evidence_snapshot"]["verification_status"] == "MANIFEST_MISMATCH"
    assert task["evidence_snapshot"]["relationships"]["config_at_head_matches_registration"] is False
    assert task["worker_amount"] == 0
    assert task["requester_amount"] == 0


def test_config_terms_at_the_pr_head_must_match_the_registered_task(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    mock_github_evidence(
        direct_vm,
        config_text=direct_vm.docket_config_text.replace(
            TITLE,
            "A different delivery title",
        ),
    )

    result = contract.resolve_dispute(task_id)
    task = contract.get_task(task_id)
    assert result["status"] == "NEEDS_EVIDENCE"
    assert task["evidence_snapshot"]["verification_status"] == "MANIFEST_MISMATCH"
    assert task["evidence_snapshot"]["relationships"]["config_terms_match_registration"] is False


def test_configuration_can_be_verified_from_a_public_fork_pr_head(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    mock_github_evidence(
        direct_vm,
        head_full_name="contributor/rate-limiter",
    )
    direct_vm.mock_llm(r".*neutral settlement validator.*", partial_findings())

    result = contract.resolve_dispute(task_id)
    task = contract.get_task(task_id)

    assert direct_vm.run_validator() is True
    assert result["status"] == "RESOLVED"
    assert task["evidence_snapshot"]["config_repository"] == "contributor/rate-limiter"
    assert task["evidence_snapshot"]["relationships"]["config_source_is_public"] is True


def test_worker_can_replace_the_manifest_after_an_inconclusive_snapshot(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.mock_web(
        r"https://api\.github\.com/repos/acme/rate-limiter/pulls/42$",
        {"status": 503, "body": json.dumps({"message": "Service unavailable"})},
    )
    contract.resolve_dispute(task_id)

    direct_vm.sender = direct_bob
    contract.supplement_evidence(task_id, manifest(head_sha=NEXT_HEAD_SHA))
    task = contract.get_task(task_id)
    assert task["status"] == "DISPUTED"
    assert task["evidence_version"] == 2
    assert task["evidence_manifest"]["head_sha"] == NEXT_HEAD_SHA
    assert task["evidence_snapshot"] == {}
    assert task["config_sha256"] == direct_vm.docket_config_sha256


def test_worker_can_amend_a_superseded_delivery_before_or_during_review(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = register(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(task_id, manifest())
    contract.supplement_evidence(task_id, manifest(head_sha=NEXT_HEAD_SHA))
    task = contract.get_task(task_id)
    assert task["status"] == "SUBMITTED"
    assert task["evidence_version"] == 2
    assert task["evidence_manifest"]["head_sha"] == NEXT_HEAD_SHA

    direct_vm.sender = direct_alice
    contract.open_dispute(task_id, "The amended public PR head still needs a criterion review.")
    direct_vm.sender = direct_bob
    contract.supplement_evidence(task_id, manifest(head_sha=HEAD_SHA))
    task = contract.get_task(task_id)
    assert task["status"] == "DISPUTED"
    assert task["evidence_version"] == 3
    assert task["evidence_manifest"]["head_sha"] == HEAD_SHA


def test_requester_cannot_refund_an_unadjudicated_submission_after_thirty_days(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = register(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob
    contract.submit_delivery(task_id, manifest())
    direct_vm.sender = direct_alice
    direct_vm.warp("2030-01-01T00:00:00Z")

    with direct_vm.expect_revert("Task has not completed an inconclusive adjudication"):
        contract.refund_inconclusive_task(task_id)

    task = contract.get_task(task_id)
    assert task["status"] == "SUBMITTED"
    assert task["requester_amount"] == 0
    assert task["worker_amount"] == 0


def test_requester_cannot_refund_an_unadjudicated_dispute_after_thirty_days(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.warp("2030-01-01T00:00:00Z")

    with direct_vm.expect_revert("Task has not completed an inconclusive adjudication"):
        contract.refund_inconclusive_task(task_id)

    assert contract.get_task(task_id)["status"] == "DISPUTED"


def test_requester_has_an_absolute_recovery_deadline_despite_evidence_amendments(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.mock_web(
        r"https://api\.github\.com/repos/acme/rate-limiter/pulls/42$",
        {"status": 503, "body": json.dumps({"message": "Service unavailable"})},
    )
    contract.resolve_dispute(task_id)

    direct_vm.sender = direct_bob
    contract.supplement_evidence(task_id, manifest(head_sha=NEXT_HEAD_SHA))
    assert contract.get_task(task_id)["status"] == "DISPUTED"

    direct_vm.sender = direct_alice
    direct_vm.warp("2030-01-01T00:00:00Z")
    contract.resolve_dispute(task_id)
    assert contract.get_task(task_id)["status"] == "NEEDS_EVIDENCE"
    contract.refund_inconclusive_task(task_id)
    task = contract.get_task(task_id)
    assert task["status"] == "REFUNDED"
    assert task["requester_amount"] == 10_000


def test_requester_can_recover_an_inconclusive_task_after_seven_days(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.mock_web(
        r"https://api\.github\.com/repos/acme/rate-limiter/pulls/42$",
        {"status": 503, "body": json.dumps({"message": "Service unavailable"})},
    )
    contract.resolve_dispute(task_id)

    with direct_vm.expect_revert("Recovery is available seven days after an inconclusive review"):
        contract.refund_inconclusive_task(task_id)

    direct_vm.warp("2030-01-01T00:00:00Z")
    contract.refund_inconclusive_task(task_id)
    task = contract.get_task(task_id)
    assert task["status"] == "REFUNDED"
    assert task["worker_amount"] == 0
    assert task["requester_amount"] == 10_000


def test_inconclusive_recovery_emits_an_external_refund(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/docket.py")
    task_id = submit_and_dispute(contract, direct_vm, direct_alice, direct_bob)
    direct_vm.mock_web(
        r"https://api\.github\.com/repos/acme/rate-limiter/pulls/42$",
        {"status": 503, "body": json.dumps({"message": "Service unavailable"})},
    )
    contract.resolve_dispute(task_id)
    direct_vm.warp("2030-01-01T00:00:00Z")

    emitted = capture_external_messages(
        direct_vm,
        lambda: contract.refund_inconclusive_task(task_id),
    )

    assert_eth_sends(emitted, [(direct_alice, 10_000)])
