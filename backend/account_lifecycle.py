"""Coordinate account erasure with ongoing requests (one API worker).

Ordinary requests remain concurrent. Erasure waits for existing requests (CGM,
AI, uploads...) and prevents new ones until credentials have been revalidated.
The persistent deletion flag additionally makes failed erasures resumable.
"""
import asyncio
from contextlib import asynccontextmanager
from weakref import WeakValueDictionary


class AccountGate:
    def __init__(self):
        self.condition = asyncio.Condition()
        self.readers = 0
        self.writers = 0
        self.exclusive = False

    @asynccontextmanager
    async def access(self, erase=False):
        async with self.condition:
            if erase:
                self.writers += 1
                try:
                    await self.condition.wait_for(lambda: not self.readers and not self.exclusive)
                    self.exclusive = True
                finally:
                    self.writers -= 1
                    self.condition.notify_all()
            else:
                await self.condition.wait_for(lambda: not self.exclusive and not self.writers)
                self.readers += 1
        try:
            yield
        finally:
            async with self.condition:
                if erase:
                    self.exclusive = False
                else:
                    self.readers -= 1
                self.condition.notify_all()


_gates = WeakValueDictionary()


def account_gate(user_id: str) -> AccountGate:
    gate = _gates.get(user_id)
    if gate is None:
        gate = AccountGate()
        _gates[user_id] = gate
    return gate