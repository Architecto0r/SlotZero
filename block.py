import hashlib
import time


class Block:
    def __init__(self, parent_hash, proposer_id, slot):
        self.parent_hash = parent_hash
        self.proposer = proposer_id
        self.slot = slot
        self.timestamp = time.time()
        self.hash = self._compute_hash()
        
    def _compute_hash(self):
        data = f"{self.parent_hash}{self.proposer}{self.slot}{self.timestamp}"
        return hashlib.sha256(data.encode()).hexdigest()