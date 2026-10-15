"""Batch-scoped affinity and prefix warm-ups shared across story event loops."""
import asyncio
import hashlib
import json
from concurrent.futures import Future
from threading import Lock
from uuid import uuid4


class EditorialCache:
    def __init__(self):
        self._session = str(uuid4())
        self._lock = Lock()
        self._prefixes: dict[str, Future[None]] = {}

    def claim(self, base_url: str, model: str, effort: str, prompt: str, schema: dict):
        identity = json.dumps([base_url, model, effort, prompt, schema], sort_keys=True)
        fingerprint = hashlib.sha256(identity.encode()).hexdigest()
        with self._lock:
            owner = fingerprint not in self._prefixes
            if owner:
                self._prefixes[fingerprint] = Future()
            completion = self._prefixes[fingerprint]
        return f"{self._session}-{fingerprint[:20]}", fingerprint, owner, completion

    @staticmethod
    async def wait(completion: Future[None]):
        # Each story has its own event loop. Cancellation must not cancel the
        # shared completion or strand another story waiting for this prefix.
        await asyncio.shield(asyncio.wrap_future(completion))
