Work on this issue:

{title}

{body}

First, create a git worktree for this work:
1. Create branch `issue-{number}` if it doesn't exist
2. Create a worktree at `../$(basename $PWD)-issue-{number}`
3. Switch to that worktree directory

Follow TDD: write failing tests first, then implement. Create a PR when complete.
