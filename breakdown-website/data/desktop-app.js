// This file covers only the Electron desktop app and its renderer, preload, and main-process state.
window.breakdownWebsiteData = window.breakdownWebsiteData || {};

window.breakdownWebsiteData.desktopApp = {
  id: "desktop-app",
  title: "Desktop App UI State Breakdown",
  eyebrow: "desktop-app/",
  summary:
    "The desktop app is a local dashboard. Its UI depends on Electron API availability, dashboard data, selected repo, Git graph derived state, dialogs and context menus, background refresh, app update status, analytics privacy, and user Git operations.",
  sourceFiles: [
    "desktop-app/src/renderer/index.html",
    "desktop-app/src/renderer/App.tsx",
    "desktop-app/src/renderer/threadGroups.ts",
    "desktop-app/src/renderer/branchSyncWarnings.ts",
    "desktop-app/src/renderer/analytics.ts",
    "desktop-app/src/preload/preload.ts",
    "desktop-app/src/shared/types.ts",
    "desktop-app/src/main/main.ts",
    "desktop-app/src/main/dashboard.ts",
    "desktop-app/src/main/dashboardRefresh.ts",
    "desktop-app/src/main/appServerClient.ts",
    "desktop-app/src/main/gitActions.ts",
    "desktop-app/src/main/gitData.ts",
    "desktop-app/src/main/appUpdates.ts",
    "desktop-app/electron-builder.config.cjs",
    "desktop-app/README_PACKAGING.md",
  ],

  // -------------------------- UI variables ---------------
  highLevelVariables: [
    {
      variable: "electronApi",
      source: "window.crabtree from preload.ts",
      states: "missing, available",
      notes:
        "If the preload API is missing, the renderer shows a desktop UI fallback instead of the main app.",
    },
    {
      variable: "desktopNavigationBoundary",
      source: "BrowserWindow windowOpenHandler and will-navigate handlers",
      states: "internalRendererUrl, externalSystemBrowserUrl",
      notes:
        "The desktop BrowserWindow stays on the Electron renderer. Any website, GitHub, docs, or other web URL is opened outside the desktop app.",
    },
    {
      variable: "dashboardData",
      source:
        "readDashboard, readDashboardIfIdle, readDashboardAfterGitMutation",
      states: "notLoaded, loaded, loadError, refreshError",
      notes:
        "Initial load errors replace the app with an error screen. Refresh errors after data exists show toasts while keeping the previous dashboard.",
    },
    {
      variable: "selectedRepo",
      source: "selectedRepoRoot plus DashboardData.repos",
      states: "none, selected, selectedContextLoading",
      notes:
        "The app keeps the selected repo if it still exists after refresh, otherwise it chooses the first repo.",
    },
    {
      variable: "repoGraphData",
      source: "RepoGraph, GitCommit, GitWorktree, CodexThread, gitChangesOfCwd",
      states: "emptyRepos, commitRows, dirtyThreadGroupRows, chatOnlyRows",
      notes:
        "The visible graph is derived from Git commits, worktrees, Codex threads, uncommitted changes, and the Codex Chats filter.",
    },
    {
      variable: "pathLauncher",
      source: "Renderer select",
      states: "vscode, cursor, finder",
      notes:
        "The selected launcher is used by repo, worktree, and thread cwd open actions.",
    },
    {
      variable: "appUpdateStatus",
      source: "electron-updater controller",
      states: "unavailable, idle, checking, downloading, ready, error",
      notes:
        "The Settings update button text and behavior come directly from this state.",
    },
    {
      variable: "settingsState",
      source: "isSettingsModalOpen, isPrivateMode, appUpdateStatus",
      states: "closed, open, privateModeOn, privateModeOff",
      notes:
        "Settings exposes version, updater action, private analytics mode, and GitHub link.",
    },
    {
      variable: "globalBranchSyncConfirmation",
      source: "branchSyncConfirmation",
      states: "none, push, revert",
      notes:
        "Header Push and Sync open a repo-level confirmation based on visible branch/tag sync changes.",
    },
    {
      variable: "commitHistoryPresentation",
      source: "columnWidths, didResizeGraphColumn, shouldShowChatOnly",
      states: "defaultColumns, resizedColumns, allRows, chatOnlyRows",
      notes:
        "These states change the graph/table view without changing backend data.",
    },
    {
      variable: "commitHistoryMenus",
      source:
        "gitRefCreateMenuTarget, copyContextMenuTarget, gitRefContextMenuTarget",
      states: "none, addRefMenu, copyMenu, branchOrTagMenu",
      notes:
        "Only one context menu is open at a time. Escape or outside mousedown closes the open menu.",
    },
    {
      variable: "commitHistoryDialogs",
      source: "dialog target states inside CommitHistory",
      states:
        "branchCreate, gitRefCreate, pullRequestCreate, commitMessage, changeSummary, gitRefDelete, branchMerge, branchPush, headMove, branchPointerMove",
      notes:
        "Every dialog is driven by a nullable target object. A null target means that dialog is closed.",
    },
    {
      variable: "branchPointerDrag",
      source: "branchPointerDragRef and branchPointerDropTargetRowId",
      states:
        "none, draggingHead, draggingBranch, draggingTag, validDropTarget",
      notes:
        "Dragging HEAD opens a Move HEAD confirmation. Dragging branches or tags opens branch/tag pointer move confirmation.",
    },
    {
      variable: "threadStatus",
      source: "Codex app-server notifications plus dashboard reads",
      states: "notLoaded, idle, systemError, active",
      notes:
        "Active threads show a spinner on the chat button. Status notifications can update loaded dashboard data directly.",
    },
    {
      variable: "userGitUpdate",
      source: "userGitUpdateCountRef and loading toast",
      states: "idle, running, refreshingAfterMutation",
      notes:
        "User Git updates block dashboard replacement until a post-mutation dashboard read has painted.",
    },
    {
      variable: "dashboardRefresh",
      source: "isDashboardRefreshRunningRef, shouldRefreshDashboardAgainRef",
      states: "idle, running, queued",
      notes:
        "Automatic refreshes are skipped if a refresh or user Git update is already running.",
    },
    {
      variable: "toasts",
      source: "sonner",
      states: "none, loading, success, error, dashboardWarning",
      notes:
        "Errors use longer-lived toasts when the window is not focused. Dashboard warnings can be dismissed while still current.",
    },
  ],

  // -------------------------- State types ---------------
  variableTypes: [
    {
      name: "DesktopEntryState",
      typeScript: `type DesktopEntryState =
  | { type: "missingElectronApi"; message: "Open this app from Electron" }
  | { type: "electronApiReady"; api: "window.crabtree" };`,
    },
    {
      name: "DesktopNavigationBoundaryState",
      typeScript: `type DesktopNavigationBoundaryState =
  | { type: "internalRendererUrl"; url: string; staysInBrowserWindow: true }
  | { type: "externalSystemBrowserUrl"; url: string; staysInBrowserWindow: false };`,
    },
    {
      name: "DashboardUiState",
      typeScript: `type DashboardUiState =
  | { type: "notLoaded"; isLoading: true; errorMessage: null }
  | { type: "loadError"; isLoading: false; errorMessage: string }
  | { type: "loaded"; data: DashboardData; errorMessage: null }
  | { type: "refreshError"; data: DashboardData; errorMessage: string };`,
    },
    {
      name: "SelectedRepoUiState",
      typeScript: `type SelectedRepoUiState =
  | { type: "none"; reason: "noRepos" | "dashboardNotLoaded" }
  | { type: "selected"; repoRoot: string; repo: RepoGraph }
  | { type: "selectedContextLoading"; repoRoot: string; previousRepo: RepoGraph | null };`,
    },
    {
      name: "PathLauncherState",
      typeScript: `type PathLauncherState =
  | { type: "vscode"; label: "VS Code" }
  | { type: "cursor"; label: "Cursor" }
  | { type: "finder"; label: "Finder" };`,
    },
    {
      name: "DesktopSettingsState",
      typeScript: `type DesktopSettingsState =
  | { type: "closed" }
  | { type: "open"; isPrivateMode: boolean; appUpdateStatus: AppUpdateStatus };`,
    },
    {
      name: "AppUpdateStatus",
      typeScript: `type AppUpdateStatus =
  | { type: "unavailable" }
  | { type: "idle" }
  | { type: "checking" }
  | { type: "downloading"; version: string }
  | { type: "ready"; version: string }
  | { type: "error"; message: string };`,
    },
    {
      name: "BranchSyncConfirmationState",
      typeScript: `type BranchSyncConfirmationState =
  | { type: "none" }
  | { type: "push"; repoRoot: string; changes: GitBranchSyncChange[] }
  | { type: "revert"; repoRoot: string; changes: GitBranchSyncChange[] };`,
    },
    {
      name: "CommitHistoryMenuState",
      typeScript: `type CommitHistoryMenuState =
  | { type: "none" }
  | { type: "addRefMenu"; x: number; y: number; sha: string | null; isEnabled: boolean; pullRequestTarget: GitPullRequestCreateTarget | null }
  | { type: "copyMenu"; x: number; y: number; text: string; errorMessage: string }
  | { type: "branchOrTagMenu"; x: number; y: number; gitRefType: "branch" | "tag"; name: string; oldSha: string; warningMessage: string | null; shouldBlockDelete: boolean };`,
    },
    {
      name: "CommitHistoryDialogState",
      typeScript: `type CommitHistoryDialogState =
  | { type: "none" }
  | { type: "branchCreate"; target: BranchCreateTarget; input: string; previewName: string }
  | { type: "gitRefCreate"; gitRefType: "branch" | "tag"; sha: string; input: string; previewName: string }
  | { type: "pullRequestCreate"; target: GitPullRequestCreateTarget; baseBranch: string; headBranch: string; title: string; description: string }
  | { type: "commitMessage"; target: CommitMessageTarget; message: string }
  | { type: "changeSummary"; target: ChangeSummaryTarget }
  | { type: "gitRefDelete"; target: GitRefDeleteTarget }
  | { type: "branchMerge"; target: BranchMergeConfirmation }
  | { type: "branchPush"; target: BranchPushConfirmation }
  | { type: "headMove"; target: HeadMoveConfirmation }
  | { type: "branchPointerMove"; target: BranchPointerMove };`,
    },
    {
      name: "BranchPointerDragState",
      typeScript: `type BranchPointerDragState =
  | { type: "none" }
  | { type: "draggingHead"; repoRoot: string; oldSha: string; dropTargetRowId: string | null }
  | { type: "draggingBranch"; repoRoot: string; branch: string; oldSha: string; sourcePath: string | null; dropTargetRowId: string | null }
  | { type: "draggingTag"; repoRoot: string; tag: string; oldSha: string; dropTargetRowId: string | null };`,
    },
    {
      name: "CodexThreadStatus",
      typeScript: `type CodexThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: string[] };`,
    },
    {
      name: "DashboardRefreshState",
      typeScript: `type DashboardRefreshState =
  | { type: "idle"; pendingRepoRoot: null }
  | { type: "running"; repoRoot: string | null }
  | { type: "queued"; runningRepoRoot: string | null; pendingRepoRoot: string | null };`,
    },
    {
      name: "UserGitUpdateState",
      typeScript: `type UserGitUpdateState =
  | { type: "idle"; runningCount: 0 }
  | { type: "running"; runningCount: number; toastId: string; description: string }
  | { type: "refreshingAfterMutation"; runningCount: number; waitsForPaint: true };`,
    },
    {
      name: "ToastState",
      typeScript: `type ToastState =
  | { type: "none" }
  | { type: "loading"; description: string; dismissible: false }
  | { type: "success"; message: string }
  | { type: "error"; message: string; windowFocused: boolean }
  | { type: "dashboardWarning"; warning: string; dismissedWhileCurrent: boolean };`,
    },
  ],

  // -------------------------- UI flow ---------------
  flowchart: `flowchart TD
  start["Desktop renderer starts"] --> api{"window.crabtree exists?"}
  api -->|No| missing["Electron API missing screen"]
  api -->|Yes| initial["Initial loading screen from index.html"]
  initial --> dashboardRead["Read dashboard from Codex and Git"]
  dashboardRead -->|Failure before data| loadError["Failed to load repositories screen + Retry"]
  loadError --> retry["Retry dashboard read"] --> dashboardRead
  dashboardRead -->|Success| loaded["App shell loaded"]
  loaded --> repoChoice{"Repos found?"}
  repoChoice -->|No| empty["Empty state"]
  repoChoice -->|Yes| repo["Selected repo graph"]
  repo --> repoLoading["Selected repo context loading overlay"]
  repo --> graph["Commit graph and table"]
  graph --> repoPicker["Repo picker menu"]
  graph --> launcherPicker["Path launcher menu"]
  graph --> chatFilter["Codex Chats filter on or off"]
  graph --> contextMenus["Context menus"]
  contextMenus --> addRefMenu["Add branch, tag, or PR menu"]
  contextMenus --> copyMenu["Copy menu"]
  contextMenus --> branchTagMenu["Branch or tag copy/delete menu"]
  graph --> dialogs["Commit history dialogs"]
  dialogs --> branchCreate["Create Branch dialog"]
  dialogs --> tagCreate["Create Branch or Tag dialog"]
  dialogs --> pullRequest["Create Pull Request dialog"]
  dialogs --> commit["Commit message dialog"]
  dialogs --> changes["Change Summary dialog"]
  dialogs --> deleteRef["Delete Branch or Tag confirmation"]
  dialogs --> merge["Merge Branch confirmation"]
  dialogs --> rowPush["Row Push confirmation"]
  dialogs --> headMove["Move HEAD confirmation"]
  dialogs --> pointerMove["Move Branch Pointer or Move Tag confirmation"]
  graph --> drag["Drag HEAD, branch, or tag"]
  drag --> dropTarget["Valid row drop target highlight"]
  dropTarget --> headMove
  dropTarget --> pointerMove
  loaded --> headerActions["Header actions"]
  headerActions --> syncModal["Sync confirmation"]
  headerActions --> pushModal["Push confirmation"]
  headerActions --> settings["Settings dialog"]
  settings --> updateStates["Update unavailable, idle, checking, downloading, ready, or error"]
  settings --> privateMode["Private mode on or off"]
  loaded --> externalWebUrl["External web URL clicked"]
  externalWebUrl --> systemBrowser["Open in system browser"]
  loaded --> toasts["Loading, success, error, and dashboard warning toasts"]
  dashboardRead -->|Failure after data| refreshError["Keep current dashboard and show error toast"]`,

  // -------------------------- Background state ---------------
  backgroundStates: [
    {
      state: "Codex app-server absent or starting",
      trigger: "First dashboard read or explicit status client start",
      behavior:
        "The main process spawns codex app-server, initializes it, and caches the client until it closes or times out.",
    },
    {
      state: "Codex app-server connected",
      trigger: "initialize request resolves",
      behavior:
        "Dashboard reads request thread/list. Status notifications update renderer thread status through IPC.",
    },
    {
      state: "Dashboard refresh idle",
      trigger: "No read is in progress",
      behavior:
        "Automatic refresh can call readDashboardIfIdle once per interval.",
    },
    {
      state: "Dashboard refresh running",
      trigger: "Full read, repo-specific read, or post-mutation read starts",
      behavior:
        "Overlapping reads are merged or skipped. User Git updates prevent replacing data until the mutation refresh completes.",
    },
    {
      state: "Git mutation running",
      trigger:
        "User confirms create, commit, delete, merge, move, push, sync, or checkout",
      behavior:
        "A non-dismissible loading toast is shown. Changed repo roots are marked for refresh.",
    },
    {
      state: "Waiting for post-mutation paint",
      trigger: "readDashboardAfterGitMutation succeeds",
      behavior:
        "The app waits one animation frame after applying data before dismissing the loading toast.",
    },
    {
      state: "App update unavailable",
      trigger: "Development build, unpackaged build, or missing app-update.yml",
      behavior: "Settings shows Updates disabled.",
    },
    {
      state: "App update checking or downloading",
      trigger: "Packaged app calls electron-updater",
      behavior:
        "Settings button shows Checking... or Downloading... and the updater sends status changes to the renderer.",
    },
    {
      state: "App update ready",
      trigger: "electron-updater finishes download",
      behavior:
        "Settings button changes to Update. Clicking it calls quitAndInstall.",
    },
    {
      state: "Analytics enabled",
      trigger: "Private mode is false",
      behavior:
        "The renderer identifies the install id and captures desktop action events with surface desktop.",
    },
    {
      state: "Analytics private mode",
      trigger: "Private mode is true",
      behavior:
        "The renderer resets PostHog, opts out of capture, and skips desktop action tracking.",
    },
    {
      state: "External web navigation",
      trigger:
        "User clicks a GitHub link or any non-internal URL tries to navigate the BrowserWindow",
      behavior:
        "The main process prevents the desktop BrowserWindow from navigating and opens the URL in the system browser.",
    },
    {
      state: "Dashboard warnings active",
      trigger: "DashboardData.warnings contains current warning text",
      behavior:
        "Each warning can show an infinite toast. Dismissed warnings stay dismissed until the warning disappears.",
    },
  ],

  // -------------------------- Backend products ---------------
  backendProducts: [
    {
      product: "Codex app-server",
      usedBy:
        "Dashboard thread list, thread status notifications, open chat URLs",
      neededOutsideRepo:
        "A working Codex install. macOS checks /Applications/Codex.app/Contents/Resources/codex, otherwise it runs codex from PATH.",
      expectedSource: "User machine.",
    },
    {
      product: "Local Git repositories",
      usedBy:
        "Repo discovery, graph reads, branch/tag/worktree operations, merge preview, merge, checkout, push, sync",
      neededOutsideRepo:
        "Repos must exist on disk, be readable by the app, and have Git installed. Git prompts are disabled with GIT_TERMINAL_PROMPT=0.",
      expectedSource: "User filesystem and installed Git.",
    },
    {
      product: "Git remotes",
      usedBy: "Origin sync state, push, sync, PR base/head validation",
      neededOutsideRepo:
        "Configured origin remotes and whatever credentials Git already uses outside the app.",
      expectedSource: "User Git credential setup.",
    },
    {
      product: "GitHub CLI",
      usedBy: "Create Pull Request dialog",
      neededOutsideRepo: "gh must be installed, on PATH, and authenticated.",
      expectedSource: "User machine.",
    },
    {
      product: "GitHub Releases",
      usedBy: "electron-updater and release download assets",
      neededOutsideRepo:
        "Public release assets and latest*.yml files generated by Electron Builder.",
      expectedSource: "GitHub Actions publish-release job.",
    },
    {
      product: "Apple Developer signing and notarization",
      usedBy: "macOS installer release pipeline",
      neededOutsideRepo:
        "APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD, plus either APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_P8_BASE64 or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.",
      expectedSource:
        "GitHub repository secrets for CI or local shell env for local signing.",
    },
    {
      product: "PostHog",
      usedBy: "Anonymous desktop metrics",
      neededOutsideRepo:
        "No runtime env var. The desktop renderer has POSTHOG_PROJECT_TOKEN, POSTHOG_HOST, and POSTHOG_UI_HOST constants in code.",
      expectedSource: "Checked-in renderer analytics constants.",
    },
    {
      product: "OS app URL handlers",
      usedBy:
        "Open Codex threads, VS Code paths, Cursor paths, and external URLs",
      neededOutsideRepo:
        "codex://, vscode://file, cursor://file, and default browser handlers need the matching apps installed. External web URLs leave the desktop BrowserWindow.",
      expectedSource: "User machine.",
    },
    {
      product: "Electron app userData",
      usedBy: "Analytics install id storage",
      neededOutsideRepo: "Writable Electron userData directory.",
      expectedSource: "Electron app.getPath('userData').",
    },
  ],

  // -------------------------- User features ---------------
  features: [
    {
      feature: "Load dashboard",
      stateChanges: [
        "Initial HTML loading screen remains until dashboard data or an error exists.",
        "Success sets dashboardData, chooses a selected repo, merges thread notification statuses, clears dashboardErrorMessage, and removes the initial loading root.",
        "Initial failure shows the failed-to-load screen with Retry.",
      ],
      backendResponses: [
        "Codex app-server returns threads.",
        "Git reads repo graphs, worktrees, commits, changes, sync changes, warnings, and errors.",
      ],
    },
    {
      feature: "Retry dashboard load",
      stateChanges: [
        "The load error screen calls refreshDashboard again.",
        "A later success moves into the normal app shell.",
      ],
      backendResponses: ["Codex and Git dashboard reads run again."],
    },
    {
      feature: "Select repo",
      stateChanges: [
        "selectedRepoRoot changes.",
        "loadingRepoRoot shows a repository loading overlay for the selected repo.",
        "A repo-specific dashboard read runs and clears loadingRepoRoot when it finishes.",
      ],
      backendResponses: [
        "Dashboard read focuses on the selected repo root.",
        "PostHog captures repo_selected.",
      ],
    },
    {
      feature: "Open selected repo or code location",
      stateChanges: [
        "No persistent app state changes.",
        "An error toast appears if the selected launcher fails.",
      ],
      backendResponses: [
        "Electron opens VS Code, Cursor, or Finder.",
        "PostHog captures repo_opened with launcher and source.",
      ],
    },
    {
      feature: "Change path launcher",
      stateChanges: ["pathLauncher changes to vscode, cursor, or finder."],
      backendResponses: ["PostHog captures path_launcher_changed."],
    },
    {
      feature: "Filter graph to Codex chats",
      stateChanges: [
        "shouldShowChatOnly toggles.",
        "visibleGraph is rebuilt with rows that have thread ids and matching segments.",
      ],
      backendResponses: ["PostHog captures codex_chats_filter_changed."],
    },
    {
      feature: "Resize commit history columns",
      stateChanges: [
        "Column width state updates for detail columns.",
        "Graph width changes set didResizeGraphColumn to true.",
      ],
      backendResponses: ["No backend response."],
    },
    {
      feature: "Open Codex chat",
      stateChanges: [
        "No persistent renderer state changes.",
        "Active threads already show a spinner based on Codex status.",
      ],
      backendResponses: [
        "Electron opens codex://threads/<threadId>.",
        "The main process starts or reuses app-server status sync.",
        "PostHog captures chat_opened.",
      ],
    },
    {
      feature: "Open branch/tag/row context menus",
      stateChanges: [
        "Existing context menus close.",
        "One of addRefMenu, copyMenu, or branchOrTagMenu opens at the pointer location and is kept inside the window.",
      ],
      backendResponses: ["No backend response until the user chooses an item."],
    },
    {
      feature: "Copy text",
      stateChanges: [
        "The copy context menu closes.",
        "A success toast or error toast appears.",
      ],
      backendResponses: ["Electron writes text to the clipboard."],
    },
    {
      feature: "Create branch",
      stateChanges: [
        "Branch create dialog opens from a dirty path, empty row, or add-ref menu.",
        "Input is normalized into a preview name when needed.",
        "Confirm closes the dialog, shows a loading toast, refreshes the dashboard, then shows success or error.",
      ],
      backendResponses: [
        "Main process validates the request.",
        "Git creates a branch or ref.",
        "Dashboard refresh reads new Git state.",
        "PostHog captures branch_created.",
      ],
    },
    {
      feature: "Create tag",
      stateChanges: [
        "Tag create dialog opens from the add-ref menu.",
        "Input is normalized into a preview name when needed.",
        "Confirm closes the dialog, shows a loading toast, refreshes, then shows success or error.",
      ],
      backendResponses: [
        "Git creates a tag ref.",
        "Dashboard refresh reads new Git state.",
        "PostHog captures tag_created.",
      ],
    },
    {
      feature: "Create pull request",
      stateChanges: [
        "Create Pull Request dialog opens from the add-ref menu when the row is a commit.",
        "The form can show missing head branch, missing base branch, or same-branch warnings.",
        "Confirm closes the dialog, shows a loading toast, refreshes, then opens the PR URL if GitHub returns one.",
      ],
      backendResponses: [
        "Git validates local and origin commit ids.",
        "GitHub CLI creates the pull request.",
        "Electron opens the returned PR URL.",
        "PostHog captures pull_request_created.",
      ],
    },
    {
      feature: "Show change summary",
      stateChanges: [
        "Change Summary dialog opens with staged and unstaged counts.",
        "Open Repository uses the selected path launcher.",
      ],
      backendResponses: [
        "No backend read is needed to open the dialog because counts are already in dashboardData.",
        "PostHog captures change_summary_opened.",
      ],
    },
    {
      feature: "Commit changes",
      stateChanges: [
        "Commit dialog opens for dirty thread group rows that can map to a branch target.",
        "Confirm closes the dialog, shows a loading toast, refreshes, then shows success or error.",
      ],
      backendResponses: [
        "Git commits all changes for the path.",
        "If the target branch should move, Git moves that branch after commit.",
        "Dashboard refresh reads new Git state.",
        "PostHog captures changes_committed.",
      ],
    },
    {
      feature: "Delete branch or tag",
      stateChanges: [
        "Delete confirmation opens from the branch/tag context menu.",
        "Warnings display when deleting would remove a useful graph anchor or when deleting a tag.",
        "Default branch and checked-out branch deletes are disabled.",
        "Confirm closes the dialog, shows a loading toast, refreshes, then shows success or error.",
      ],
      backendResponses: [
        "Git deletes the branch or tag.",
        "Dashboard refresh reads new Git state.",
        "PostHog captures branch_deleted or tag_deleted.",
      ],
    },
    {
      feature: "Merge branch",
      stateChanges: [
        "Merge action is offered only for a mergeable row and is disabled when HEAD is not clean.",
        "Opening the modal first fetches merge preview counts.",
        "Confirm closes the modal, shows a loading toast, refreshes, then shows success or error.",
      ],
      backendResponses: [
        "Git previews merge added lines, removed lines, and conflict count.",
        "Git merges the branch.",
        "Dashboard refresh reads new Git state.",
        "PostHog captures branch_merged.",
      ],
    },
    {
      feature: "Push branch/tag sync changes from row",
      stateChanges: [
        "Row Push confirmation opens for branch/tag changes on that row.",
        "Push warnings display when branch sync warnings exist.",
        "Confirm closes the modal, shows a loading toast, refreshes, then shows success or error.",
      ],
      backendResponses: [
        "Git pushes the selected sync changes.",
        "Dashboard refresh reads origin state.",
        "PostHog captures branches_pushed with source commit_graph.",
      ],
    },
    {
      feature: "Push or Sync repo from header",
      stateChanges: [
        "Header Push or Sync opens a repo-level confirmation when visible changes exist.",
        "Confirm closes the modal, shows a loading toast, refreshes, then shows success or error.",
      ],
      backendResponses: [
        "Push sends local branch/tag changes to origin.",
        "Sync reverts local tag and branch changes to match origin.",
        "Dashboard refresh reads origin state.",
        "PostHog captures branches_pushed or branches_pulled.",
      ],
    },
    {
      feature: "Move HEAD by double-click or drag",
      stateChanges: [
        "Double-clicking a commit row starts checkout immediately.",
        "Dragging HEAD to a commit row opens Move HEAD confirmation.",
        "Confirm shows a loading toast, refreshes, then shows success or error.",
      ],
      backendResponses: [
        "Git checks out the target commit or branch.",
        "Dashboard refresh reads new HEAD state.",
        "PostHog captures head_dragged and head_switched.",
      ],
    },
    {
      feature: "Move branch pointer or tag",
      stateChanges: [
        "Dragging a branch or tag highlights valid drop targets.",
        "Dropping opens Move Branch Pointer or Move Tag confirmation.",
        "Blocked checked-out branch moves disable confirm.",
        "Warnings display for tag movement or when moving could hide commits.",
      ],
      backendResponses: [
        "Git moves the branch or tag.",
        "Dashboard refresh reads new refs.",
        "PostHog captures branch_dragged, tag_dragged, branch_moved, or tag_moved.",
      ],
    },
    {
      feature: "Open Settings",
      stateChanges: [
        "Settings dialog opens.",
        "Private mode checkbox toggles isPrivateMode and PostHog opt-in or opt-out state.",
        "Update button text changes from appUpdateStatus.",
        "The GitHub link does not navigate the desktop BrowserWindow.",
      ],
      backendResponses: [
        "Private mode changes PostHog capture state.",
        "GitHub link opens in the system browser and captures github_clicked.",
      ],
    },
    {
      feature: "Check for update or install ready update",
      stateChanges: [
        "If appUpdateStatus is ready, clicking Update quits and installs.",
        "Otherwise clicking checks for update and may set idle, ready, error, checking, or downloading.",
        "Success or error toasts show for final idle, ready, or error results.",
      ],
      backendResponses: [
        "electron-updater checks GitHub release metadata from app-update.yml.",
        "electron-updater downloads and installs when ready.",
      ],
    },
  ],

  // -------------------------- State decisions ---------------
  decisions: [
    {
      decision: "Never render web pages inside the desktop BrowserWindow.",
      reason:
        "The desktop app depends on preload IPC and local app state. Web pages such as crabtree.app and GitHub are not desktop UI states.",
      carryOver:
        "New desktop links should use openExternalUrl or the main-process external navigation guards.",
    },
    {
      decision:
        "Initial load error replaces the app, refresh error keeps the app.",
      reason:
        "Before first data exists there is no useful repo graph to show. After data exists, stale data is better than hiding the whole app.",
      carryOver:
        "Future refresh failures should prefer toast plus previous data unless the current data cannot be trusted.",
    },
    {
      decision:
        "User Git mutations own their loading toast until dashboard paint.",
      reason:
        "The app should not say a Git action finished before the UI has shown the resulting Git state.",
      carryOver:
        "Any new Git mutation should use the same post-mutation refresh and paint wait path.",
    },
    {
      decision: "Only one context menu can be open.",
      reason:
        "Right-click menus are mutually exclusive and should close on outside mousedown or Escape.",
      carryOver:
        "New commit-history menus should reuse the same target pattern and close the other menu targets.",
    },
    {
      decision: "Nullable dialog targets are the dialog state.",
      reason:
        "Each dialog needs the object it will act on. Null means closed, which avoids extra booleans.",
      carryOver:
        "New dialogs should prefer a single target object instead of a separate open boolean plus loose state.",
    },
    {
      decision:
        "Branch and tag safety warnings are UI state derived from graph reachability and worktree ownership.",
      reason:
        "The warning is about what the user sees and could lose track of, not just whether Git accepts the command.",
      carryOver:
        "Future ref actions should derive warnings before opening confirmation, then validate again in the backend.",
    },
    {
      decision: "Merge is disabled when HEAD is dirty.",
      reason:
        "The UI has uncommitted changes context and avoids starting merges into a dirty working tree.",
      carryOver:
        "New merge-like features should respect the same clean-head requirement unless the UI explicitly handles conflicts.",
    },
    {
      decision:
        "Desktop private mode is local UI state plus PostHog opt-out state.",
      reason:
        "Private mode should affect capture immediately and persist through localStorage.",
      carryOver:
        "Any new desktop analytics event should go through trackDesktopAction so private mode applies.",
    },
    {
      decision: "GitHub PR creation requires pushed origin branches.",
      reason:
        "The dialog creates PRs from remote refs and the main process verifies that the row data is not stale.",
      carryOver:
        "PR features should avoid implicit pushing from the PR creation flow.",
    },
  ],
};
