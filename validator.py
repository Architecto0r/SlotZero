import random
import hashlib


class Validator:
    def __init__(self, vid, reliability=0.95):
        self.id = vid
        self.reliability = reliability


    def vote(self, block_hash):
        """Returns a simple "signature" (mock) if the validator is active in this slot."""
        if random.random() < self.reliability:
            sig = hashlib.sha256(f"{self.id}-{block_hash}".encode()).hexdigest()
            return {"validator": self.id, "signature": sig}
        return None