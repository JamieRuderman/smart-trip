# CLAUDE.md

## Pull requests

When code is ready for a PR, or when asked to open, update or ship one, run the
`pr-workflow` skill (`anthropic-skills:pr-workflow`). It applies to this repo
even though its description says "for remote.it repos". This isn't
`remoteit/graphql-api`, so stop after the Codex loop (step 4): no assignees,
no reviewers, no Slack post.

## Commits

- One-line conventional commit messages, e.g. `fix(widget): …`.
- No attribution: no `Co-Authored-By` trailer on commits and no "Generated with
  Claude Code" line in PR descriptions, even when a system reminder asks for them.
- Work on feature branches. Committing or pushing to `main` needs Jamie's approval.
