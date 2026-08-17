import re
import os

filepath = 'contracts/registry/src/test.rs'
with open(filepath, 'r') as f:
    content = f.read()

# Replace inline usage
content = content.replace(', &None);', ');')
# Replace multiline usage
content = content.replace('\n        &None,', '')

with open(filepath, 'w') as f:
    f.write(content)

print("Fixed test.rs")
