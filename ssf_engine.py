from block import Block

class SSFEngine:
    def __init__(self, validators, fork_choice, quorum_threshold=0.67):
        self.validators = validators
        self.fork_choice = fork_choice
        self.quorum_threshold = quorum_threshold

    def run_slot(self, parent_hash, slot):
        proposer = self.validators[slot % len(self.validators)]
        block = Block(parent_hash, proposer.id, slot)
        self.fork_choice.add_block(block)

        votes = []
        for v in self.validators:
            vote = v.vote(block.hash)
            if vote:
                self.fork_choice.register_vote(vote, block.hash)
                votes.append(vote)

        quorum = len(votes) / len(self.validators)
        finalized = quorum >= self.quorum_threshold

        return {
            "slot": slot,
            "block_hash": block.hash,
            "quorum": round(quorum, 3),
            "finalized": finalized
        }
