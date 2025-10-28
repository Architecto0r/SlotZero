from validator import Validator
from fork_choice import ForkChoice
from ssf_engine import SSFEngine

def main():
    validators = [Validator(i) for i in range(64)]
    fc = ForkChoice()
    ssf = SSFEngine(validators, fc)

    parent_hash = "0xgenesis"
    for slot in range(1, 12):
        result = ssf.run_slot(parent_hash, slot)
        status = " FINALIZED" if result['finalized'] else " pending"
        print(f"Slot {slot}: quorum={result['quorum']*100:.1f}% → {status}")
        if result['finalized']:
            parent_hash = result['block_hash']

if __name__ == "__main__":
    main()
