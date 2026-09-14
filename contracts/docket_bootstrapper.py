# { "Depends": "py-genlayer:test" }

import typing

import genlayer as gl


_CALC_MANAGER = gl.storage.InmemManager()
CODE_SLOT = (
    _CALC_MANAGER.get_store_slot(gl.storage.ROOT_SLOT_ID)
    .indirect(gl.vm.ABI.root_offsets.CODE)
    .id
)
LOCKED_SLOT = (
    _CALC_MANAGER.get_store_slot(gl.storage.ROOT_SLOT_ID)
    .indirect(gl.vm.ABI.root_offsets.LOCKED_SLOTS)
    .id
)
VACANT_SLOT = _CALC_MANAGER.get_store_slot(gl.storage.ROOT_SLOT_ID).indirect(
    gl.vm.ABI.root_offsets.MAJOR
)
SPECIAL_SLOTS = [gl.storage.ROOT_SLOT_ID, CODE_SLOT, LOCKED_SLOT]
SPECIAL_SLOTS_TWINS = {
    slot: VACANT_SLOT.indirect(index).id
    for index, slot in enumerate(SPECIAL_SLOTS)
}


def get_twin_vla(slot_id: bytes) -> gl.storage.VLA[gl.types.u8]:
    return gl.storage.cast_slot(
        gl.storage.VLA[gl.types.u8], gl.storage.Root.MANAGER, slot_id, 0
    )


def write_to_twin(slot_id: bytes, offset: int, data: bytes):
    as_vla = get_twin_vla(slot_id)
    old_len = len(as_vla)
    as_vla.slot().write(as_vla.data_offset() + offset, data)
    as_vla.set_length(max(old_len, offset + len(data)))


class DocketBootstrapper(gl.contract.Contract):
    def __init__(self, *, save_default_locked_slots: bool = True):
        root = gl.storage.Root.get()
        if save_default_locked_slots:
            twin_slot_id = SPECIAL_SLOTS_TWINS[LOCKED_SLOT]
            locked_slots_dst = gl.storage.cast_slot(
                gl.storage.VLA[gl.types.u256],
                gl.storage.Root.MANAGER,
                twin_slot_id,
                4,
            )
            locked_slots_dst.assign(root.locked_slots.get())
            locked_slots_dst_vla = get_twin_vla(twin_slot_id)
            locked_slots_dst_vla.set_length(
                len(locked_slots_dst) * 32 + locked_slots_dst.data_offset()
            )
        root.locked_slots.get().truncate()

    @gl.public.write
    def push_code(self, code: bytes):
        """Append one gas-safe piece of the final contract source."""
        twin_slot_id = SPECIAL_SLOTS_TWINS[CODE_SLOT]
        code_twin_vla = get_twin_vla(twin_slot_id)
        code_vla = gl.storage.cast_slot(
            gl.storage.VLA[gl.types.u8],
            gl.storage.Root.MANAGER,
            twin_slot_id,
            4,
        )
        code_vla.extend(code)
        code_twin_vla.set_length(len(code_vla) + 4)

    @gl.public.write
    def finish(self):
        """Copy the staged source into the live code slot."""
        buffer_size = 65_536
        for destination, source in SPECIAL_SLOTS_TWINS.items():
            source_vla = get_twin_vla(source)
            copy_len = len(source_vla)
            destination_slot = gl.storage.Root.MANAGER.get_store_slot(destination)
            for offset in range(0, copy_len, buffer_size):
                chunk_size = min(buffer_size, copy_len - offset)
                data = source_vla.slot().read(
                    source_vla.data_offset() + offset,
                    chunk_size,
                )
                destination_slot.write(offset, data)
