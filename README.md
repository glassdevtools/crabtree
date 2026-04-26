# Codex Worktree Graph


Small README change for testing.


## Features by Interface

- Git graph, branches, commits, worktrees, and file change actions: `simple-git`.
- Non-archived thread list, thread history, new threads, and sending messages: Codex app-server.
- Simple start/resume/run flows: Codex app-server in v1; Codex SDK is only a possible future wrapper.
- Open a thread in Codex Desktop: deep link, using `codex://threads/<thread-id>`.
- Open a new Codex thread: deep link, using `codex://new`.
- Lookup thread id by worktree path, branch, or commit: Codex app-server thread data.
- Update stored Codex thread Git metadata: Codex app-server.
- Checkout a branch or commit in a worktree: `simple-git`, then Codex app-server `thread/metadata/update` if needed.
- Draft messages before sending: our own app storage.

## Interface Notes

### Codex SDK

- Docs: https://developers.openai.com/codex/sdk
- Not used in v1.

### Codex App Server

- Docs: https://developers.openai.com/codex/app-server
- Use for non-archived Codex thread list/read/start/resume/message/status/metadata operations.

### Simple Git

- Docs: https://github.com/steveukx/git-js#readme
- Use for local Git graph reads and local Git mutations.

### Deep Links

- Public docs: TODO. No official Codex deep-link docs found yet.
- Local links to verify: `codex://threads/<thread-id>` and `codex://new`.

### Manual SQLite Reads

- Not used in v1.
- TODO: document the read-only tables and lookup queries if we add a debug-only reader.
