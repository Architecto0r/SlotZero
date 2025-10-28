class ForkChoice:
    def __init__(self):
        self.blocks = {}
        self.votes = {}

    def add_block(self, block):
        self.blocks[block.hash] = block

    def register_vote(self, vote, block_hash):
        self.votes.setdefault(block_hash, []).append(vote)


    def get_head(self):
        """The bloc with the largest number of votes."""
        if not self.votes:
            return None
        return max(self.votes, key=lambda h: len(self.votes[h]))
