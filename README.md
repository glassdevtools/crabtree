# MoltTree
      

MoltTree is a local desktop tool for browsing Codex threads alongside their Git history and opening the right context back in Codex Desktop.

## Repo Layout

- `desktop-app/`: Electron desktop app, macOS packaging, auto-update config, and desktop tests.
- `website/`: Next.js marketing/download website.
- `.github/workflows/build-macos-installer.yml`: macOS installer release workflow.

## Commands

Install dependencies from the repo root:

```bash
npm ci
```

Run the desktop app:

```bash
npm run dev
```

This starts the website on `http://127.0.0.1:5174/` and the desktop app together.

Run only the desktop app:

```bash
npm run dev:desktop
```

Build the desktop app:

```bash
npm run build:desktop
```

Build the macOS installer:

```bash
npm run dist:mac
```

Run the website locally:

```bash
npm run dev:website
```

Build the website:

```bash
npm run build:website
```

## Desktop Features By Interface

- Git graph, branches, commits, thread markers, and file change actions: `simple-git`.
- Non-archived thread list, thread history, new threads, and sending messages: Codex app-server.
- Simple start/resume/run flows: Codex app-server in v1; Codex SDK is only a possible future wrapper.
- Open a thread in Codex Desktop: deep link, using `codex://threads/<thread-id>`.
- Open a new Codex thread: deep link, using `codex://new`.
- Lookup thread id by working directory, branch, or commit: Codex app-server thread data.
- Update stored Codex thread Git metadata: Codex app-server.
- Checkout commits, create branches, preview merges, and merge branches: `simple-git`.
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
