# @flowboard/dsh

**English** | [简体中文](README.zh-CN.md)

**Let work happen naturally in the Harness while keeping the team aligned without extra management overhead.**

Flowboard is an open-source office collaboration and team management plugin for DeepSeek Harness (DSH). It brings goals, meetings, people, agent execution, progress, and documents into one coherent workflow, so work can move continuously from discussion to execution and shared knowledge. Tasks are not the boundary of the product; they are the backbone that supports this way of working.

> **Alpha:** This version may introduce incompatible changes. It is intended for local evaluation and small-team trials, not stable production deployments.

## Management Without the Busywork

Traditional task management asks employees to finish their work and then recreate it in another system by entering tasks, updating progress, and moving documents. Flowboard derives task state directly from real work in the Harness:

- Goals and meeting action items become tasks, owners, and plans.
- Members and agents continue execution in the same task context.
- Progress, issues, documents, and decisions return to the original task and project.
- The next member or agent continues from the actual state shared by the team.

```text
Goals / meetings
       ↓
Harness agents understand and execute
       ↓
Flowboard tasks, ownership, and documents
       ↓
The team and its agents keep work moving
```

The Harness is where people and agents work. Flowboard provides its collaboration and organizational memory layer. People keep advancing the work without maintaining a separate management copy detached from reality.

## Main Capabilities

- Jira-style project boards, workflows, drag and drop, assignees, priority, progress, and due dates.
- Multidimensional task tables with custom text, number, date, single-select, multi-select, and people fields.
- My Tasks, personal boards, personal calendars, and cross-project views.
- Browser VAD, local Whisper transcription, a meeting Supervisor, intent revision, and post-meeting summaries.
- Traceable relationships among projects, meetings, tasks, and Markdown documents.
- A shared authorization, validation, idempotency, optimistic locking, transaction, and audit pipeline for the UI and agents.

The plugin tarball is the only public distribution unit. It contains the Host, Web Client, agent tools, SQLite service, Linux x64 Whisper runtime, and the complete `ggml-small` model.

## Installation

Flowboard requires Linux x64, Node.js `22.19+` or `24+`, DeepSeek Harness `0.1.0-rc.6`, and about 500 MB of free disk space.

Download the `.tgz` and `SHA256SUMS` files from a GitHub Alpha prerelease, verify the checksum, and install the package:

```sh
dsh plugin --profile web add ./flowboard-dsh-*.tgz
dsh web
```

Open `http://127.0.0.1:3080` and select **Flowboard** in the main DSH session view.

## First Use

1. On first launch, Flowboard creates a local Owner, default team, and default project. Rename them to match your actual organization.
2. Return to a DSH conversation and ask an agent to create the first tasks. For example: “Create a project for the product Alpha launch and break design review, plugin packaging, and installation verification into tasks.”
3. On the Flowboard home page, select **Start a meeting → Start now**, allow microphone access, and discuss normally.
4. After the meeting, open the project board to review tasks, owners, risks, documents, and the summary created from the discussion.
5. Return to the Harness and let owners or agents continue from those tasks and update the results.

You can also ask an agent directly:

```text
List the tasks assigned to me this week that do not have a due date.

Summarize unresolved risks from the last three meetings in the product project.

Turn the technical decisions from this discussion into a project document
and link it to the relevant tasks.
```

## Data and Upgrades

Data is stored in `$DSH_HOME/flowboard`, or `~/.dsh/flowboard` when `DSH_HOME` is not set. Upgrading or uninstalling the plugin does not automatically delete this directory.

```sh
# Upgrade to a downloaded Alpha build
dsh plugin --profile web add --force ./flowboard-dsh-*.tgz

# Uninstall the plugin
dsh plugin --profile web remove @flowboard/dsh
```

The browser never reads a Flowboard API token. Embedded mode generates a random token on every startup and uses it only inside the Host. The Whisper CLI, shared libraries, and model are bundled with the package, so default transcription does not depend on a system installation of Whisper or ffmpeg.

For the complete product guide, GitHub Release installation steps, current limitations, architecture, development workflow, and open-source policies, see the [Flowboard repository](https://github.com/juntaoding/Flowboard#readme).
