# Flowboard

**English** | [简体中文](README.zh-CN.md)

**Let work happen naturally in the Harness while keeping the team aligned without extra management overhead.**

Flowboard is an open-source office collaboration and team management plugin for DeepSeek Harness (DSH). It brings goals, meetings, people, agent execution, progress, and documents into one coherent workflow, so work can move continuously from discussion to execution and shared knowledge. Tasks are not the boundary of the product; they are the backbone that supports this way of working.

> **Alpha:** `0.1.2-alpha.5` is still at an early validation stage. APIs, data structures, and installation procedures may change incompatibly. It is intended for local evaluation and small-team trials, not stable production deployments.

## Management Without the Busywork

Traditional task management makes employees do the same work twice: first they meet, communicate, and execute, then they open another system to create tasks, assign owners, update progress, and organize documents. The management system records a manually maintained copy of the work rather than the work itself. As soon as people stop updating it, the board becomes inaccurate.

AI-assisted work makes this problem even more visible. People already use agents in the Harness to research, write, analyze, plan, and execute. If those results remain in individual sessions, the team still cannot see who is doing what, how work is progressing, or what has been produced. Someone eventually has to copy the information and report it manually.

Flowboard changes how task information is created:

- When work begins, goals and meeting action items become tasks, owners, and plans.
- While work is in progress, members and agents execute and update progress in the same task context.
- When work is completed, documents, decisions, and supporting material return to the original task and project.
- When the team collaborates, every member and agent reads the same authoritative state and continues from there.

People still complete tasks, but no longer have to manage a separate copy of them. **Management happens as the work happens.**

## One Operating Model Across the Harness

The Harness is where people and agents work. Flowboard provides its collaboration and organizational memory layer. Goals set direction, meetings create alignment, people and agents execute together, progress stays current, and documents preserve the outcome. Tasks connect these stages instead of becoming a form that employees must maintain outside their conversations.

```text
An employee sets a goal / the team holds a meeting
                         ↓
The Harness agent understands intent and existing context
                         ↓
Flowboard creates tasks, ownership, plans, and linked documents
                         ↓
Members and agents continue execution in their own sessions
                         ↓
Progress, issues, documents, and decisions return to one task context
                         ↓
The next member or agent continues from the actual state of the work
```

DSH remains responsible for sessions, models, agents, and the plugin lifecycle. Flowboard does not create a second agent entry point or make DSH depend on a standalone application. Users install only `@flowboard/dsh`; the UI and agents then share the same `FlowboardService`, data, and authorization rules.

## How a Complete Workflow Unfolds

Consider a product meeting:

1. **Before the meeting:** A member asks an agent to read project progress, incomplete tasks, and related documents, then assemble the meeting context.
2. **During the meeting:** Flowboard segments audio locally in the browser and transcribes it with the bundled Whisper runtime. The meeting Supervisor continuously identifies action items, decisions, risks, and supporting material.
3. **Live revisions:** “Assign it to Alex,” “No, change that to Sam,” and “Finish it by next Wednesday” are understood as successive revisions to one intent rather than three duplicate tasks.
4. **After the meeting:** Tasks, owners, due dates, decisions, risks, the meeting summary, and linked documents are already part of the project. No second round of manual data entry is needed.
5. **Continued execution:** The owner returns to their Harness session and asks an agent to research, write, or execute. Task status and outputs continue to accumulate in the original context.

Managers see state produced by the work itself, not a status report filled in afterward.

## What You Get

| Capability | What it changes |
| --- | --- |
| AI-native office collaboration | Agents can read team context and connect goals, meetings, tasks, and documents without employees transcribing everything into another system. |
| Jira-style project boards | Manage tasks with workflows such as To Do, In Progress, and Done, including drag and drop, assignees, priority, progress, and due dates. |
| Multidimensional task tables | View and edit tasks in a dense table with custom text, number, date, single-select, multi-select, and people fields. |
| AI meeting secretary | Browser VAD, local Whisper, live transcription, intent revision, persisted action items, and post-meeting summaries form a complete workflow. |
| Documents and organizational memory | Markdown documents can be linked to projects, meetings, and tasks, allowing agents to follow the history and rationale behind the work. |
| Personal and team perspectives | My Tasks, personal boards, personal calendars, and project workspaces share the same business facts instead of duplicating data. |
| Authorization and auditability | Writes from both the UI and agents pass through authorization, runtime validation, idempotency, optimistic locking, transactions, versioning, and audit logs. |

## Quick Start

### Requirements

- Linux x64. The bundled native Whisper runtime is currently available only for this platform.
- Node.js `22.19+` or `24+`.
- DeepSeek Harness `0.1.0-rc.6`, with the `dsh` command available.
- About 500 MB of free disk space. The plugin includes the complete `ggml-small` model.

### Install From a GitHub Release

Every Alpha tag creates a GitHub prerelease containing the complete plugin tarball and `SHA256SUMS`. Because the package includes the full Whisper model and is larger than npm clients can publish reliably, Alpha builds are distributed through GitHub Releases:

```sh
FLOWBOARD_VERSION=0.1.2-alpha.5
curl -LO "https://github.com/juntaoding/Flowboard/releases/download/v${FLOWBOARD_VERSION}/flowboard-dsh-${FLOWBOARD_VERSION}.tgz"
curl -LO "https://github.com/juntaoding/Flowboard/releases/download/v${FLOWBOARD_VERSION}/SHA256SUMS"
sha256sum -c SHA256SUMS
dsh plugin --profile web add "./flowboard-dsh-${FLOWBOARD_VERSION}.tgz"
dsh web
```

Open `http://127.0.0.1:3080` and select **Flowboard** in the main DSH session view.

The release asset includes the complete Whisper model and is approximately 430 MB. Install it only after the checksum succeeds.

## First Use

On first launch, Flowboard creates a local Owner, a default team, and a default project so you can start immediately. Data is stored in `$DSH_HOME/flowboard`, or `~/.dsh/flowboard` when `DSH_HOME` is not set.

### 1. Explore the Workspace

When you open **Flowboard**, the sidebar provides the complete office navigation:

- **Home:** Today's tasks, schedule, active projects, and recent AI operations.
- **My Tasks / Personal Board / Personal Calendar:** Work aggregated across projects for the current person.
- **Meetings / Documents:** Team meetings and knowledge outputs.
- **People / Teams:** Organization and permission management.
- **Projects:** Overview, Jira board, task list, meetings, documents, and members for each project.

A good first step is to rename `Default Team` and `Default Project`, then add real members, workflows, and tasks.

### 2. Ask an Agent to Create the First Tasks

Return to a DSH conversation and describe the work directly instead of filling in a complete form first:

```text
Create a project for the product Alpha launch and break design review,
plugin packaging, installation verification, and release notes into tasks.

Assign plugin installation verification to me, set the priority to high,
and make it due this Friday.

List the tasks assigned to me that do not have a due date yet.
```

Flowboard's agent tools read the current workspace, choose a writable project, and create or update real tasks within the user's permissions. When non-critical fields are missing, they can first create a provisional entity that remains easy to revise. Deletions and irreversible operations still require confirmation.

### 3. Start the First AI Meeting

On the Flowboard home page, select **Start a meeting → Start now**, allow microphone access, and discuss normally. Instant meetings automatically execute validated safe operations by default. When creating a meeting from the meeting list, you can also choose record only, suggest before execution, or automatically execute safe operations.

During the meeting, you can monitor:

- whether live transcription continues to arrive;
- whether the Supervisor is waiting for delivery, analyzing, or caught up;
- whether action items are created, revised, or withdrawn;
- whether AI questions, project documents, and operation records enter the same meeting context.

When you select **End meeting**, Flowboard drains the final audio segment, waits for transcription and intent processing to converge, generates a summary, and then closes the meeting. Open the project board afterward to review the resulting tasks and documents.

### 4. Continue in the Harness

Meetings are only one input. You can continue by asking an agent:

```text
Summarize unresolved risks from the last three meetings in the product project.

Turn the technical decisions from this discussion into a project document
and link it to the relevant tasks.

Read the context for FLOW-12, complete the research, then update the task's
progress and conclusions.
```

This is the core Flowboard workflow: stay in the Harness, avoid maintaining a duplicate task system, and let agents continue from shared work state.

## Installation Management

Upgrade to an Alpha build you have already downloaded:

```sh
dsh plugin --profile web add --force ./flowboard-dsh-*.tgz
```

Uninstall the plugin:

```sh
dsh plugin --profile web remove @flowboard/dsh
```

Upgrading or uninstalling does not automatically delete `$DSH_HOME/flowboard`. To remove data, stop DSH first, back up the directory, and verify the exact path before deleting it.

## Data and Security Boundaries

- DSH is the only host and startup entry point. The Flowboard API, SQLite database, and Worker start and stop with the plugin lifecycle.
- The browser calls the Host only through DSH Typert Remote and never reads or stores an upstream API token.
- Embedded mode generates a random 32-byte access token on every startup and uses it only inside the Host.
- The Whisper CLI, shared libraries, and `ggml-small` model are bundled with the plugin. Default transcription does not depend on a system installation of Whisper or ffmpeg.
- Audio is processed by the local Flowboard runtime. The Worker removes completed or failed temporary segments.
- Every write goes through the same server-side authorization, validation, idempotency, optimistic locking, transaction, and audit pipeline.

For implementation details, see [DSH Native Plugin Architecture and Release Specification](docs/architecture/dsh-native-plugin.md) and [System Architecture Overview](docs/architecture/system-overview.md). These design documents are currently maintained in Chinese.

## Alpha Limitations

- The default setup currently uses one local Owner. Full account sign-in, invitations, and token management are not yet integrated.
- Persistence currently uses SQLite. There is no PostgreSQL adapter or distributed deployment option.
- The bundled Whisper runtime supports Linux x64 only. Other platforms require additional validated vendor variants.
- The database schema is evolving rapidly and there is no production migration chain yet.
- Agents can read the workspace, create and update projects, tasks, and documents, and process meeting intents. However, not every DSH session is automatically bound to a task; richer execution tracking across sessions remains a product direction.

## Local Development

```sh
git lfs install
git lfs pull
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` runs the full checks, builds a real npm tarball, installs it into an isolated `.dsh-dev` profile with `dsh plugin --profile web add`, and starts `dsh web`. It does not use workspace symlinks or a temporary `--patch`, so it exercises the same installation boundary as an end user.

Before releasing:

```sh
pnpm run check
pnpm run plugin:pack
pnpm run plugin:package-check
pnpm run plugin:install-check
pnpm run release:check
```

Only `@flowboard/dsh` is publicly distributed. Contracts, Server, Host, Client, and the Typert adapter remain private source modules in this repository and are assembled into one plugin package during the build. The Whisper model is stored through Git LFS; source assets, staging directories, and final tarballs are all checked for SHA-256 integrity and executable permissions.

## Open Source and Contributing

Flowboard is available under the [MIT License](LICENSE). Before opening an issue or pull request, read the [Contributing Guide](CONTRIBUTING.md), [Security Policy](SECURITY.md), [Code of Conduct](CODE_OF_CONDUCT.md), and [Third-Party Notices](THIRD_PARTY_NOTICES.md). Version changes are recorded in the [Changelog](CHANGELOG.md).

Alpha releases accept only `v*-alpha.*` tags and are published as GitHub prereleases. Release packages must pass a real DSH installation, web startup, API health check, and Whisper asset audit.

## Documentation

The following technical documents are currently maintained in Chinese:

- [DSH Native Plugin Architecture and Release Specification](docs/architecture/dsh-native-plugin.md)
- [System Architecture Overview](docs/architecture/system-overview.md)
- [Workspace and AI Meeting Design](docs/dev/flowboard-workspace-ai-refactor.md)
- [Meeting Supervisor Design](docs/dev/flowboard-meeting-supervisor-refactor.md)
- [Complete Refactoring Notes](docs/dev/flowboard-full-refactor.md)
