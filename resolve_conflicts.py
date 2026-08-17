import sys
import re

def resolve_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # For disputes.rs
    if 'disputes.rs' in filepath:
        # HEAD is empty, main has locking logic. Keep main.
        content = re.sub(r'<<<<<<< HEAD\n=======\n(.*?)\n>>>>>>> main\n', r'\1\n', content, flags=re.DOTALL)

    # For errors.rs
    elif 'errors.rs' in filepath:
        # HEAD added ProtocolPaused, main added InsufficientStake etc.
        # We need to renumber.
        conflict_pattern = r'<<<<<<< HEAD\n(.*?)\n=======\n(.*?)\n>>>>>>> main\n'
        match = re.search(conflict_pattern, content, re.DOTALL)
        if match:
            head_block = match.group(1)
            main_block = match.group(2)
            # Reassign ProtocolPaused = 32
            head_block_fixed = head_block.replace('= 26', '= 32')
            resolved_block = main_block + '\n' + head_block_fixed
            content = content[:match.start()] + resolved_block + '\n' + content[match.end():]

    # For events.rs
    elif 'events.rs' in filepath:
        # Keep both
        content = re.sub(r'<<<<<<< HEAD\n(.*?)\n=======\n(.*?)\n>>>>>>> main\n', r'\2\n\1\n', content, flags=re.DOTALL)

    # For lib.rs
    elif 'lib.rs' in filepath:
        # Merge resolve_dispute
        # HEAD added pausable line. Main changed signature to single line.
        conflict_pattern = r'<<<<<<< HEAD\n    pub fn resolve_dispute\(\n        env: Env,\n        caller: Address,\n        id: u64,\n        final_outcome: CommitmentStatus,\n    \) \{\n        // Fail fast if the protocol has been paused \(emergency halt\)\.\n        pausable::require_not_paused\(&env\);\n\n=======\n    pub fn resolve_dispute\(env: Env, caller: Address, id: u64, final_outcome: CommitmentStatus\) \{\n>>>>>>> main\n'
        resolved_block = """    pub fn resolve_dispute(env: Env, caller: Address, id: u64, final_outcome: CommitmentStatus) {
        // Fail fast if the protocol has been paused (emergency halt).
        pausable::require_not_paused(&env);
"""
        content = re.sub(conflict_pattern, resolved_block, content, flags=re.DOTALL)

    with open(filepath, 'w') as f:
        f.write(content)

resolve_file('contracts/registry/src/disputes.rs')
resolve_file('contracts/registry/src/errors.rs')
resolve_file('contracts/registry/src/events.rs')
resolve_file('contracts/registry/src/lib.rs')

print("Resolved base conflicts.")
