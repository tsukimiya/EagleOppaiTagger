---
name: pr-review-check
description: Fetch ALL PR review comments including bot issue-level reviews via GitHub MCP server
---
Use the GitHub MCP server (`github-mcp-server`) for structured access — prefer it over `gh` CLI.

1. Call `pull_request_read` with `method=get_reviews` for review-level comments (summaries, approvals, changes-requested).
2. Call `pull_request_read` with `method=get_review_comments` for inline (file-level) review threads.
3. Call `pull_request_read` with `method=get_comments` for general PR comments.
4. Call `issue_read` with `method=get_comments` for issue-level comments on the PR (this is where Copilot / github-actions[bot] / Claude bot summaries usually appear).
5. List every Copilot, github-actions[bot], and Claude bot finding across all four sources.
6. Address each before declaring done. Replies can be posted via `add_reply_to_pull_request_comment`.
