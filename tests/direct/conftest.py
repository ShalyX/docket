"""Direct-test compatibility settings for Docket's pinned contract runtime."""

import os
from pathlib import Path
import tempfile
from typing import Optional

from gltest.direct import loader as direct_loader
from gltest.direct import sdk_loader
from gltest.direct.vm import VMContext


GENVM_DIRECT_VERSION = "v0.2.16"
_setup_sdk_paths = sdk_loader.setup_sdk_paths
_cleanup_after_deactivate = VMContext._cleanup_after_deactivate


def _setup_pinned_sdk_paths(
    contract_path: Optional[Path] = None,
    version: Optional[str] = None,
):
    """Avoid the stale latest-release lookup in genlayer-test 0.29.2."""
    return _setup_sdk_paths(contract_path, version or GENVM_DIRECT_VERSION)


sdk_loader.setup_sdk_paths = _setup_pinned_sdk_paths


def _inject_message_to_fd0_windows(vm: VMContext) -> None:
    """Keep the temporary stdin path until Windows releases descriptor zero."""
    from genlayer.py import calldata
    from genlayer.py.types import Address

    sender = Address(vm.sender) if isinstance(vm.sender, bytes) else vm.sender
    contract = (
        Address(vm._contract_address)
        if isinstance(vm._contract_address, bytes)
        else vm._contract_address
    )
    origin = Address(vm.origin) if isinstance(vm.origin, bytes) else vm.origin
    encoded = calldata.encode(
        {
            "contract_address": contract,
            "sender_address": sender,
            "origin_address": origin,
            "stack": [],
            "value": vm._value,
            "datetime": vm._datetime,
            "is_init": False,
            "chain_id": vm._chain_id,
            "entry_kind": 0,
            "entry_data": b"",
            "entry_stage_data": None,
        }
    )

    fd, path = tempfile.mkstemp()
    try:
        os.write(fd, encoded)
        os.lseek(fd, 0, os.SEEK_SET)
        vm._original_stdin_fd = os.dup(0)
        os.dup2(fd, 0)
        vm._docket_stdin_path = path
    finally:
        os.close(fd)


def _cleanup_windows_stdin(self: VMContext) -> None:
    path = getattr(self, "_docket_stdin_path", None)
    try:
        _cleanup_after_deactivate(self)
    finally:
        if path:
            try:
                Path(path).unlink()
            except FileNotFoundError:
                pass
            self._docket_stdin_path = None


if os.name == "nt":
    direct_loader._inject_message_to_fd0 = _inject_message_to_fd0_windows
    VMContext._cleanup_after_deactivate = _cleanup_windows_stdin
