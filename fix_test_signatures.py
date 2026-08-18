import sys
import re

with open('contracts/registry/src/test.rs', 'r') as f:
    content = f.read()

# Fix create_commitment
content = re.sub(
    r'(client\.(?:try_)?create_commitment\([^,]+, [^,]+, [^,]+, [^,]+, [^,]+)\)',
    r'\1, &soroban_sdk::Vec::new(&env), &0)',
    content
)

# Fix initialize
content = re.sub(
    r'client\.initialize\(&([^,)]+)\);',
    r'client.initialize(&soroban_sdk::vec![&env, \1.clone()]);',
    content
)

# Fix try_upgrade
content = re.sub(
    r'client\.try_upgrade\(&stranger, &mock_wasm_hash\)',
    r'client.try_upgrade(&mock_wasm_hash, &2)',
    content
)

with open('contracts/registry/src/test.rs', 'w') as f:
    f.write(content)
