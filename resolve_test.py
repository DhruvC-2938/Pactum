import re

with open('contracts/registry/src/test.rs', 'r') as f:
    text = f.read()

# Fix the very first conflict which is just clippy allow
text = text.replace("""<<<<<<< HEAD
#![allow(clippy::bool_assert_comparison)]
=======
>>>>>>> origin/main""", "#![allow(clippy::bool_assert_comparison)]")

# Now resolve all the create_commitment conflicts
# They typically look like:
"""
<<<<<<< HEAD
    let commitment_id = client.create_commitment(
        &issuer,
        &counterparty,
        &terms_hash,
        &due_at,
        &Vec::new(&env),
        &0,
        &None,
    );
=======
    let commitment_id = client.create_commitment(&issuer, &counterparty, &terms_hash, &due_at, &resolver);
>>>>>>> origin/main
"""
# Or similar variations.
# Since we just want to replace ALL create_commitment calls across the file to the new 8-arg format,
# we can just delete all git conflict markers, and then regex replace ALL create_commitment calls.

# 1. Delete all git conflict markers in test.rs
# Wait, if we just remove the conflict markers and keep HEAD, then we just need to add &resolver.
# If we keep origin/main, we need to add the other 3 args.
# Let's write a regex to replace the entire conflict block with the merged code.

pattern = re.compile(r'<<<<<<< HEAD\s*(.*?)\s*=======\s*(.*?)\s*>>>>>>> origin/main', re.DOTALL)

def replacer(match):
    head = match.group(1)
    main = match.group(2)
    
    # Check if this is a create_commitment conflict
    if "create_commitment" in head and "create_commitment" in main:
        # We know we need 8 arguments. 
        # Usually it's: `let ... = client.create_commitment(` or `client.create_commitment(`
        # Let's extract the variable assignment part from main (e.g. `let id1 = client.create_commitment(`)
        m = re.search(r'(let\s+.*?=\s*)?client\.(try_)?create_commitment\((.*?)\);', main, re.DOTALL)
        if m:
            prefix = m.group(1) or ""
            is_try = m.group(2) or ""
            args_str = m.group(3)
            # args in main: &issuer, &counterparty, &terms_hash, &due_at, &resolver
            # we want to insert &Vec::new(&env), &0, &None before &resolver
            # But wait, HEAD might have custom values for attestors, threshold, template!
            # Let's extract args from HEAD.
            m_head = re.search(r'client\.(try_)?create_commitment\((.*?)\);', head, re.DOTALL)
            if m_head:
                head_args_str = m_head.group(2)
                head_args = [a.strip() for a in head_args_str.split(',')]
                # head args: issuer, counterparty, terms_hash, due_at, attestors, threshold, template
                # we just need to append the resolver from main.
                main_args = [a.strip() for a in args_str.split(',')]
                resolver_arg = main_args[-1] if len(main_args) >= 5 else "&resolver"
                
                # Combine
                merged_args = head_args + [resolver_arg]
                # filter out empty strings
                merged_args = [a for a in merged_args if a]
                
                return f"{prefix}client.{is_try}create_commitment(\n        " + ",\n        ".join(merged_args) + ",\n    );"
    
    # If not create_commitment, just keep HEAD (as it might be other test additions from PR)
    # Actually let's look at the remaining conflicts to see what they are.
    return head

merged_text = pattern.sub(replacer, text)

# Write back
with open('contracts/registry/src/test.rs', 'w') as f:
    f.write(merged_text)

