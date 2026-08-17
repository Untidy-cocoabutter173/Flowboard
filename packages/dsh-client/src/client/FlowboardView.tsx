import { useCallback, useEffect, useRef, useState } from "react";
import {
  App as AntdApp,
  Avatar,
  Badge,
  Button,
  ConfigProvider,
  Menu,
  Tooltip,
  type MenuProps,
  type ThemeConfig,
} from "antd";
import {
  AppstoreOutlined,
  DownOutlined,
  CalendarOutlined,
  DashboardOutlined,
  EditOutlined,
  FileTextOutlined,
  HomeOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  StopOutlined,
  TeamOutlined,
  UpOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { ConvViewProps } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {
  FlowboardSnapshot,
  MeetingView,
  ProjectView,
} from "@flowboard/contracts";
import type {
  ClientCommand,
  FlowboardRoute,
  FlowboardState,
  MeetingRuntime,
} from "./controller.ts";
import { BoardView } from "./domain/board.tsx";
import { CalendarView } from "./domain/calendar.tsx";
import { LibraryView } from "./domain/library.tsx";
import { MarkdownEditor, MarkdownPreview } from "./domain/markdown.tsx";
import { MeetingsView } from "./domain/meetings.tsx";
import { PeopleView } from "./domain/people.tsx";
import { ProjectMembersView } from "./domain/project-members.tsx";
import { ProjectsView } from "./domain/projects.tsx";
import { TeamsView } from "./domain/teams.tsx";
import {
  Empty,
  PageHeader,
  SelectControl,
  formatDate,
} from "./domain/shared.tsx";
import { useVadRecorder } from "./use-audio-recorder.ts";
import css from "./flowboard.module.css";

export interface FlowboardInjected {
  hooks: {
    flowboard: {
      getSnapshot(): FlowboardState;
      subscribe(fn: () => void): () => void;
    };
  };
  getState(): FlowboardState;
  navigate(route: FlowboardRoute): void;
  selectPerson(personId: string): void;
  refresh(): Promise<void>;
  command(value: ClientCommand): Promise<unknown>;
  upload(
    meetingId: string,
    blob: Blob,
    clientSegmentId: string,
    startedAt: string,
    endedAt: string,
  ): Promise<{ text: string | null }>;
  setMeetingRuntime(sessionId: string, patch: Partial<MeetingRuntime>): void;
}

const projectTabs = [
  ["overview", "概览"],
  ["board", "Jira 面板"],
  ["table", "任务列表"],
  ["meetings", "会议"],
  ["library", "资料"],
  ["members", "人员"],
] as const;
const flowboardTheme: ThemeConfig = {
  token: {
    colorPrimary: "#4f46e5",
    colorInfo: "#4f46e5",
    colorSuccess: "#16835b",
    colorWarning: "#b7791f",
    colorError: "#d14343",
    colorText: "#20232a",
    colorTextSecondary: "#656b76",
    colorBorder: "#dfe2e7",
    colorBgLayout: "#f5f6f8",
    borderRadius: 6,
    fontSize: 13,
    controlHeight: 36,
    wireframe: false,
  },
  components: {
    Button: {
      primaryShadow: "0 1px 2px rgba(50, 46, 140, .18)",
      defaultShadow: "none",
      controlHeightSM: 30,
    },
    Menu: {
      itemHeight: 38,
      itemBorderRadius: 6,
      itemMarginInline: 0,
      itemMarginBlock: 2,
      itemSelectedBg: "#ecebff",
      itemSelectedColor: "#4338ca",
      itemHoverBg: "#eff1f4",
      iconSize: 16,
    },
    Modal: { borderRadiusLG: 8, titleFontSize: 16 },
    Select: { optionSelectedBg: "#ecebff", optionSelectedColor: "#4338ca" },
    Table: {
      headerBg: "#f4f5f7",
      headerColor: "#6d7380",
      rowHoverBg: "#f8f9fb",
      borderColor: "#e5e7eb",
    },
  },
};

function Sidebar({
  state,
  navigate,
  selectPerson,
}: {
  state: FlowboardState;
  navigate(route: FlowboardRoute): void;
  selectPerson(personId: string): void;
}) {
  const route = state.route;
  const snapshot = state.snapshot;
  const projects = snapshot?.projects ?? [];
  const person = snapshot?.people.find(
    (item) => item.id === state.selectedPersonId,
  );
  const openTasks =
    snapshot?.tasks.filter(
      (task) => task.assigneeId === person?.id && task.progress < 1,
    ).length ?? 0;
  const menuLabel = (label: string, count?: number) => (
    <span className={css.menuLabel}>
      <span>{label}</span>
      {count !== undefined && (
        <span className={css.menuCount}>{count > 999 ? "999+" : count}</span>
      )}
    </span>
  );
  const selectedKey =
    route.area === "home"
      ? "home"
      : route.area === "my"
        ? `my:${route.tab}`
        : route.area === "meetings"
          ? "meetings"
          : route.area === "library"
            ? "library"
            : route.area === "organization"
              ? `organization:${route.tab}`
              : route.projectId === null
                ? "projects"
                : `project:${route.projectId}`;
  const items: MenuProps["items"] = [
    { key: "home", icon: <HomeOutlined />, label: "首页" },
    {
      key: "my:tasks",
      icon: <UnorderedListOutlined />,
      label: menuLabel("我的任务", openTasks),
    },
    { key: "my:board", icon: <DashboardOutlined />, label: "个人看板" },
    { key: "my:calendar", icon: <CalendarOutlined />, label: "个人日程" },
    {
      key: "meetings",
      icon: <TeamOutlined />,
      label: menuLabel("会议列表", snapshot?.meetings.length ?? 0),
    },
    {
      key: "library",
      icon: <FileTextOutlined />,
      label: menuLabel("资料列表", snapshot?.library.length ?? 0),
    },
    { type: "divider" },
    {
      key: "organization:people",
      icon: <UserOutlined />,
      label: menuLabel("人员管理", snapshot?.people.length ?? 0),
    },
    {
      key: "organization:teams",
      icon: <TeamOutlined />,
      label: menuLabel("团队管理", snapshot?.teams.length ?? 0),
    },
    {
      type: "group",
      label: (
        <span className={css.menuGroupLabel}>
          项目 <small>{projects.length}</small>
        </span>
      ),
      children: [
        { key: "projects", icon: <AppstoreOutlined />, label: "全部项目" },
        ...projects.map((project) => ({
          key: `project:${project.id}`,
          icon: (
            <span
              className={css.projectDot}
              style={{ background: project.color }}
            />
          ),
          label: (
            <span className={css.projectMenuLabel}>
              <span>{project.name}</span>
              <small>{project.key}</small>
            </span>
          ),
        })),
      ],
    },
  ];
  const onMenu: MenuProps["onClick"] = ({ key }) => {
    if (key === "home") navigate({ area: "home" });
    else if (key === "meetings")
      navigate({ area: "meetings", meetingId: null });
    else if (key === "library") navigate({ area: "library", libraryId: null });
    else if (key === "projects")
      navigate({ area: "projects", projectId: null, tab: "overview" });
    else if (key.startsWith("my:"))
      navigate({
        area: "my",
        tab: key.slice(3) as "tasks" | "board" | "calendar",
      });
    else if (key.startsWith("organization:"))
      navigate({
        area: "organization",
        tab: key.slice(13) as "people" | "teams",
      });
    else if (key.startsWith("project:"))
      navigate({ area: "projects", projectId: key.slice(8), tab: "board" });
  };
  return (
    <aside className={css.sidebar}>
      <button
        className={css.brand}
        type="button"
        onClick={() => navigate({ area: "home" })}
      >
        <span className={css.brandMark}>F</span>
        <span>
          <strong>Flowboard</strong>
          <small>AI 协作工作台</small>
        </span>
      </button>
      <div className={css.personSwitcher}>
        <Avatar size={32}>
          {person?.name.slice(0, 1).toUpperCase() ?? "?"}
        </Avatar>
        <span>
          <small>当前工作视角</small>
          {state.selectedPersonId !== null && (
            <SelectControl
              ariaLabel="选择当前人物"
              value={state.selectedPersonId}
              onValueChange={selectPerson}
              options={(snapshot?.people ?? []).map((item) => ({
                value: item.id,
                label: item.name,
                ...(item.id === snapshot?.actor.id ? { meta: "我" } : {}),
              }))}
              className={css.personSelectTrigger}
            />
          )}
        </span>
      </div>
      <Menu
        className={css.sidebarMenu}
        mode="inline"
        selectedKeys={[selectedKey]}
        items={items}
        onClick={onMenu}
      />
    </aside>
  );
}

function ProjectHeader({
  project,
  route,
  state,
  navigate,
  refresh,
  viewTitle,
}: {
  project: ProjectView | undefined;
  route: FlowboardRoute;
  state: FlowboardState;
  navigate(route: FlowboardRoute): void;
  refresh(): Promise<void>;
  viewTitle: string;
}) {
  const person = state.snapshot?.people.find(
    (item) => item.id === state.selectedPersonId,
  );
  return (
    <>
      <header className={css.projectHeader}>
        <div className={css.projectIdentity}>
          {project === undefined ? (
            <span className={css.projectLogo}>
              {person?.name.slice(0, 1).toUpperCase() ?? "F"}
            </span>
          ) : (
            <span
              className={css.projectLogo}
              style={{ background: project.color }}
            >
              {project.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <span>
              {project?.key ??
                (person === undefined
                  ? "WORKSPACE"
                  : `${person.department || "个人"} · 当前视角`)}
            </span>
            <h1>{project?.name ?? viewTitle}</h1>
          </div>
        </div>
        <div className={css.syncState}>
          <Badge status={state.error === null ? "success" : "error"} />
          <span>{state.error === null ? "已同步" : "连接异常"}</span>
          <Tooltip title="刷新">
            <Button
              type="text"
              size="small"
              aria-label="刷新"
              disabled={state.busy}
              onClick={() => void refresh().catch(() => undefined)}
              icon={<ReloadOutlined />}
            />
          </Tooltip>
        </div>
      </header>
      {project !== undefined && (
        <nav
          className={css.projectTabs}
          aria-label={`${project.name} 项目导航`}
        >
          {projectTabs.map(([tab, label]) => (
            <button
              type="button"
              key={tab}
              data-active={route.area === "projects" && route.tab === tab}
              onClick={() =>
                navigate({ area: "projects", projectId: project.id, tab })
              }
            >
              {label}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

function Home({
  snapshot,
  personId,
  startMeeting,
  startInstantMeeting,
  navigate,
}: {
  snapshot: FlowboardSnapshot;
  personId: string | null;
  startMeeting(meeting: MeetingView): Promise<void>;
  startInstantMeeting(): Promise<void>;
  navigate(route: FlowboardRoute): void;
}) {
  const [starting, setStarting] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const person = snapshot.people.find((item) => item.id === personId);
  const tasks = snapshot.tasks
    .filter((task) => task.assigneeId === personId && task.progress < 1)
    .slice(0, 6);
  const events = snapshot.events
    .filter(
      (event) =>
        (event.ownerId === personId ||
          event.attendeeIds.includes(personId ?? "")) &&
        event.startAt.startsWith(today),
    )
    .slice(0, 6);
  const active = snapshot.projects.slice(0, 5);
  const liveMeeting = snapshot.meetings.find((meeting) => meeting.status === "live");
  const canStartMeeting =
    liveMeeting !== undefined ||
    snapshot.projects.some((item) => item.role !== "viewer") ||
    snapshot.teams.some((item) => item.role !== "viewer");
  const launchMeeting = async () => {
    if (starting) return;
    setStarting(true);
    try {
      if (liveMeeting === undefined) await startInstantMeeting();
      else await startMeeting(liveMeeting);
    } finally {
      setStarting(false);
    }
  };
  return (
    <section>
      <PageHeader
        title={`你好，${person?.name ?? snapshot.actor.name}`}
        meta="今天的任务、日程和项目进展"
      />
      <div className={css.meetingLaunch} data-live={liveMeeting !== undefined}>
        <span className={css.meetingLaunchIcon}>
          {liveMeeting === undefined ? <RobotOutlined /> : <span className={css.liveDot} />}
        </span>
        <div>
          <small>{liveMeeting === undefined ? "AI 会议" : "正在进行"}</small>
          <strong>{liveMeeting?.title ?? "开始一场会议"}</strong>
          <span>{liveMeeting === undefined ? "准备就绪" : formatDate(liveMeeting.startedAt ?? liveMeeting.createdAt)}</span>
        </div>
        <Button
          type="primary"
          size="large"
          icon={<PlayCircleOutlined />}
          loading={starting}
          disabled={!canStartMeeting}
          onClick={() => void launchMeeting().catch(() => undefined)}
        >
          {liveMeeting === undefined ? "立即开始" : "返回会议"}
        </Button>
      </div>
      <div className={css.metrics}>
        <article>
          <span>待办任务</span>
          <strong>{tasks.length}</strong>
        </article>
        <article>
          <span>今日安排</span>
          <strong>{events.length}</strong>
        </article>
        <article>
          <span>活跃项目</span>
          <strong>{snapshot.projects.length}</strong>
        </article>
        <article>
          <span>AI 操作</span>
          <strong>{snapshot.aiActions.length}</strong>
        </article>
      </div>
      <div className={css.homeGrid}>
        <section>
          <h3>我的任务</h3>
          {tasks.map((task) => (
            <button
              type="button"
              key={task.id}
              onClick={() =>
                navigate({
                  area: "projects",
                  projectId: task.projectId,
                  tab: "board",
                })
              }
            >
              <strong>{task.title}</strong>
              <span>
                {
                  snapshot.projects.find(
                    (project) => project.id === task.projectId,
                  )?.name
                }{" "}
                · {formatDate(task.dueAt, false)}
              </span>
            </button>
          ))}
          {tasks.length === 0 && <Empty title="今天没有待办任务" />}
        </section>
        <section>
          <h3>今日安排</h3>
          {events.map((event) => (
            <article key={event.id}>
              <strong>{event.title}</strong>
              <span>{formatDate(event.startAt)}</span>
            </article>
          ))}
          {events.length === 0 && <Empty title="今天没有日程" />}
        </section>
        <section>
          <h3>活跃项目</h3>
          {active.map((project) => (
            <button
              type="button"
              key={project.id}
              onClick={() =>
                navigate({
                  area: "projects",
                  projectId: project.id,
                  tab: "overview",
                })
              }
            >
              <i style={{ background: project.color }} />
              <strong>{project.name}</strong>
              <span>
                {
                  snapshot.tasks.filter(
                    (task) =>
                      task.projectId === project.id && task.progress < 1,
                  ).length
                }{" "}
                项进行中
              </span>
            </button>
          ))}
        </section>
        <section>
          <h3>最近 AI 操作</h3>
          {snapshot.aiActions.slice(0, 5).map((action) => (
            <article key={action.id}>
              <strong>{action.summary}</strong>
              <span>{formatDate(action.createdAt)}</span>
            </article>
          ))}
          {snapshot.aiActions.length === 0 && <Empty title="暂无 AI 操作" />}
        </section>
      </div>
    </section>
  );
}

function ProjectOverview({
  snapshot,
  project,
}: {
  snapshot: FlowboardSnapshot;
  project: ProjectView;
}) {
  const tasks = snapshot.tasks.filter((task) => task.projectId === project.id);
  const meetingIds = new Set(
    snapshot.links.projectMeetings
      .filter((link) => link.projectId === project.id)
      .map((link) => link.meetingId),
  );
  const documentIds = new Set(
    snapshot.links.projectLibrary
      .filter((link) => link.projectId === project.id)
      .map((link) => link.libraryItemId),
  );
  return (
    <section>
      <PageHeader
        title="项目概览"
        meta={project.description || "暂无项目描述"}
      />
      <div className={css.metrics}>
        <article>
          <span>任务</span>
          <strong>{tasks.length}</strong>
        </article>
        <article>
          <span>已完成</span>
          <strong>{tasks.filter((task) => task.progress >= 1).length}</strong>
        </article>
        <article>
          <span>会议</span>
          <strong>{meetingIds.size}</strong>
        </article>
        <article>
          <span>资料</span>
          <strong>{documentIds.size}</strong>
        </article>
      </div>
      <div className={css.projectSummary}>
        <h3>工作流</h3>
        {snapshot.workflowStatuses
          .filter((status) => status.projectId === project.id)
          .sort((a, b) => a.position - b.position)
          .map((status) => (
            <article key={status.id}>
              <i style={{ background: status.color }} />
              <strong>{status.name}</strong>
              <span>
                {tasks.filter((task) => task.statusId === status.id).length}
              </span>
            </article>
          ))}
      </div>
    </section>
  );
}

function MeetingDetail({
  snapshot,
  meeting,
  command,
  navigate,
  onStop,
}: {
  snapshot: FlowboardSnapshot;
  meeting: MeetingView;
  command(value: ClientCommand): Promise<unknown>;
  navigate(route: FlowboardRoute): void;
  onStop(meeting: MeetingView): Promise<void>;
}) {
  const [editing, setEditing] = useState<"transcript" | "summary" | null>(null);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [transcriptCollapsed, setTranscriptCollapsed] = useState(false);
  const utterances = snapshot.utterances
    .filter((item) => item.meetingId === meeting.id)
    .sort((a, b) => a.sequence - b.sequence);
  const visibleUtterances = transcriptExpanded ? utterances : utterances.slice(-6);
  const allActions = snapshot.aiActions.filter(
    (item) => item.meetingId === meeting.id,
  );
  const replies = allActions.filter((item) => item.kind === "note");
  const actions = allActions.filter((item) => item.kind !== "note");
  const binding = snapshot.meetingAgentBindings.find(
    (item) => item.meetingId === meeting.id,
  );
  const intents = snapshot.meetingIntents.filter(
    (item) => item.meetingId === meeting.id,
  );
  const assistantQuestions = intents.filter(
    (item) => item.payload.origin === "assistant",
  );
  const userIntents = intents.filter(
    (item) => item.payload.origin !== "assistant",
  );
  const latestSequence = utterances.at(-1)?.sequence ?? 0;
  const deliveredSequence = binding?.deliveredSequence ?? 0;
  const analyzedSequence = binding?.analyzedSequence ?? 0;
  const progress = latestSequence > deliveredSequence
    ? { state: "pending", label: `待投递 ${latestSequence - deliveredSequence} 条` }
    : deliveredSequence > analyzedSequence
      ? { state: "analyzing", label: `AI 正在分析 ${deliveredSequence - analyzedSequence} 条` }
      : { state: "caught-up", label: "AI 已追平" };
  const documents = new Set(
    snapshot.links.meetingLibrary
      .filter((link) => link.meetingId === meeting.id)
      .map((link) => link.libraryItemId),
  );
  return (
    <section>
      <PageHeader
        title={meeting.title}
        meta={`${meeting.status} · ${formatDate(meeting.startedAt ?? meeting.createdAt)}`}
        actions={
          <>
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditing("transcript")}
            >
              编辑转录稿
            </Button>
            <Button
              type="primary"
              size="small"
              onClick={() => setEditing("summary")}
            >
              编辑总结
            </Button>
          </>
        }
      />
      <div
        className={css.meetingWorkspace}
        data-transcript-collapsed={transcriptCollapsed}
      >
        <section className={css.meetingSummaryPanel}>
          <header>
            <div>
              <span>会议记录</span>
              <h2>核心总结</h2>
            </div>
            <span className={css.agentState} data-active={binding?.state === "active"}>
              <RobotOutlined />
              {binding?.state === "active" ? progress.label : "AI 整理结果"}
            </span>
          </header>
          {meeting.summary === "" ? (
            <div className={css.summaryPlaceholder}>
              <RobotOutlined />
              <strong>{meeting.status === "live" ? "总结正在随会议形成" : "暂无会议总结"}</strong>
              <span>决议、行动项和风险会在这里持续沉淀。</span>
            </div>
          ) : (
            <MarkdownPreview value={meeting.summary} />
          )}
          <div className={css.meetingOutcomes}>
            <section>
              <h3>决议 <span>{meeting.decisions.length}</span></h3>
              {meeting.decisions.map((item) => <p key={item}>{item}</p>)}
              {meeting.decisions.length === 0 && <small>尚未形成明确决议</small>}
            </section>
            <section>
              <h3>风险 <span>{meeting.risks.length}</span></h3>
              {meeting.risks.map((item) => <p key={item}>{item}</p>)}
              {meeting.risks.length === 0 && <small>暂无已识别风险</small>}
            </section>
          </div>
        </section>
        <aside className={css.transcriptRail}>
          <header>
            <div>
              <h3>实时转录</h3>
              <span>{utterances.length} 条 · 已分析 {analyzedSequence}/{deliveredSequence}</span>
            </div>
            <div className={css.transcriptHeaderActions}>
              {meeting.status === "live" && (
                <Button danger type="primary" size="middle" className={css.transcriptEndButton!} icon={<StopOutlined />} onClick={() => void onStop(meeting)}>
                  结束会议
                </Button>
              )}
              <Tooltip title={transcriptCollapsed ? "展开转录" : "收起转录"}>
                <Button
                  type="text"
                  size="small"
                  aria-label={transcriptCollapsed ? "展开转录" : "收起转录"}
                  icon={transcriptCollapsed ? <DownOutlined /> : <UpOutlined />}
                  onClick={() => setTranscriptCollapsed((value) => !value)}
                />
              </Tooltip>
            </div>
          </header>
          {!transcriptCollapsed && <div className={css.agentProgress} data-state={progress.state}><RobotOutlined />{progress.label}</div>}
          {!transcriptCollapsed && <>
            <div className={css.transcriptList}>
              {visibleUtterances.map((item) => (
                <article key={item.id}>
                  <time>#{item.sequence}</time>
                  <p>{item.text}</p>
                </article>
              ))}
              {utterances.length === 0 && meeting.transcript !== "" && <p>{meeting.transcript}</p>}
              {utterances.length === 0 && meeting.transcript === "" && <Empty title="等待会议转录" />}
            </div>
            {utterances.length > 6 && (
              <Button
                type="text"
                size="small"
                className={css.transcriptToggle!}
                onClick={() => setTranscriptExpanded((value) => !value)}
              >
                {transcriptExpanded ? "只看最近 6 条" : `查看全部 ${utterances.length} 条`}
              </Button>
            )}
          </>}
        </aside>
        <div className={css.meetingLowerGrid}>
          <section>
            <header><UnorderedListOutlined /><h3>用户意图</h3><span>{userIntents.length}</span></header>
            {userIntents.map((item) => (
              <article key={item.id}>
                <span className={css.intentStatus}>{item.status}</span>
                <div><strong>{item.payload.title}</strong><small>证据 #{item.evidenceFromSequence}-#{item.evidenceToSequence}</small></div>
              </article>
            ))}
            {userIntents.length === 0 && <Empty title="暂无用户意图" />}
          </section>
          <section>
            <header><QuestionCircleOutlined /><h3>AI 回复与提问</h3><span>{assistantQuestions.length + replies.length}</span></header>
            {assistantQuestions.map((item) => (
              <article key={item.id} className={css.assistantQuestion}>
                <span className={css.intentStatus}>{item.status}</span>
                <div><strong>{item.payload.question ?? item.payload.title}</strong><small>AI 提问 · 等待会议中确认</small></div>
              </article>
            ))}
            {replies.map((item) => (
              <article key={item.id} className={css.assistantReply}>
                <span className={css.replyLabel}>回复</span>
                <div><strong>{item.summary}</strong><small>{formatDate(item.createdAt)}</small></div>
              </article>
            ))}
            {assistantQuestions.length + replies.length === 0 && <Empty title="暂无 AI 回复或提问" />}
          </section>
          <section>
            <header><FileTextOutlined /><h3>会议资料</h3><span>{documents.size}</span></header>
            {snapshot.library.filter((item) => documents.has(item.id)).map((item) => (
              <button className={css.documentLink} type="button" key={item.id} onClick={() => navigate({ area: "library", libraryId: item.id })}>
                <span>MD</span><strong>{item.title}</strong>
              </button>
            ))}
            {documents.size === 0 && <Empty title="暂无会议资料" />}
          </section>
          <section>
            <header><RobotOutlined /><h3>AI 操作</h3><span>{actions.length}</span></header>
            {actions.map((item) => (
              <article key={item.id}>
                <span className={css.actionState} data-ok={item.ok}>{item.ok ? "完成" : "失败"}</span>
                <div><strong>{item.summary}</strong><small>{formatDate(item.createdAt)}</small></div>
              </article>
            ))}
            {actions.length === 0 && <Empty title="暂无 AI 操作" />}
          </section>
        </div>
      </div>
      {editing !== null && (
        <MarkdownEditor
          open
          title={
            editing === "summary"
              ? `${meeting.title} · 会议总结`
              : `${meeting.title} · 转录稿`
          }
          fileName={`${meeting.title.replace(/\s+/g, "-").toLowerCase()}-${editing}.md`}
          value={editing === "summary" ? meeting.summary : meeting.transcript}
          onClose={() => setEditing(null)}
          onSave={(value) =>
            command({
              type: "meeting.update",
              expectedVersion: meeting.version,
              payload: { id: meeting.id, [editing]: value },
            })
          }
        />
      )}
    </section>
  );
}

export function FlowboardView(
  props: ConvViewProps & InjectFace<FlowboardInjected>,
) {
  const state = props.useFlowboard((value) => value);
  const sessionId = String(props.sessionId);
  useEffect(() => {
    const binding = state.snapshot?.meetingAgentBindings.find(
      (item) => item.sessionId === sessionId && item.state === "active",
    );
    if (binding === undefined) return;
    const current = state.meetingRuntimes[sessionId];
    if (current?.meetingId !== binding.meetingId) {
      props.setMeetingRuntime(sessionId, {
        meetingId: binding.meetingId,
        error: null,
      });
    }
  }, [props, sessionId, state.meetingRuntimes, state.snapshot]);
  if (state.snapshot === null)
    return (
      <div className={css.loading}>
        <span className={css.loadingMark} />
        {state.status === "error" ? state.error : "正在连接 Flowboard"}
      </div>
    );
  const snapshot = state.snapshot;
  const route = state.route;
  const selectedPersonId = state.selectedPersonId;
  const selectedProject =
    route.area === "projects" && route.projectId !== null
      ? snapshot.projects.find((project) => project.id === route.projectId)
      : undefined;
  const viewTitle =
    route.area === "home"
      ? "首页"
      : route.area === "meetings"
        ? "会议列表"
        : route.area === "library"
          ? "资料列表"
          : route.area === "my"
            ? route.tab === "tasks"
              ? "我的任务"
              : route.tab === "board"
                ? "个人看板"
                : "个人日程"
            : route.area === "organization"
              ? route.tab === "people"
                ? "人员管理"
                : "团队管理"
              : "项目列表";
  const startMeeting = async (meeting: MeetingView) => {
    if (meeting.status !== "live") {
      await props.command({
        type: "meeting.update",
        expectedVersion: meeting.version,
        payload: { id: meeting.id, status: "live" },
      });
    }
    await props.command({
      type: "meeting.agent.bind",
      payload: { id: meeting.id, sessionId },
    });
    props.setMeetingRuntime(sessionId, { meetingId: meeting.id, error: null });
    props.navigate({ area: "meetings", meetingId: meeting.id });
  };
  const startInstantMeeting = async () => {
    let project = snapshot.projects.find((item) => item.role !== "viewer");
    if (project === undefined) {
      const team = snapshot.teams.find((item) => item.role !== "viewer");
      if (team === undefined) throw new Error("没有可写团队，无法开始会议");
      const projectResult = await props.command({
        type: "project.create",
        payload: {
          teamId: team.id,
          key: `MTG${Date.now().toString(36).slice(-7)}`.toUpperCase(),
          name: "未归档会议",
          description: "由一键会议自动创建，可在会后重命名或归档。",
        },
      }) as { entityId: string; version: number };
      project = {
        id: projectResult.entityId,
        version: projectResult.version,
        teamId: team.id,
        role: "owner",
      } as ProjectView;
    }
    const now = new Date();
    const title = `会议 · ${now.toLocaleDateString("zh-CN", { month: "long", day: "numeric" })} ${now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
    const result = await props.command({
      type: "meeting.create",
      payload: {
        teamId: project.teamId,
        projectIds: [project.id],
        title,
        settings: { automation: "execute" },
      },
    }) as { entityId: string; version: number };
    await startMeeting({ id: result.entityId, version: result.version, status: "scheduled" } as MeetingView);
  };
  const stopMeeting = async (meeting: MeetingView) => {
    props.setMeetingRuntime(sessionId, {
      meetingId: meeting.id,
      stopping: true,
      error: null,
    });
  };
  let body;
  if (route.area === "home")
    body = (
      <Home
        snapshot={snapshot}
        personId={selectedPersonId}
        startMeeting={startMeeting}
        startInstantMeeting={startInstantMeeting}
        navigate={props.navigate}
      />
    );
  else if (route.area === "projects") {
    const projectId = route.projectId;
    const project = snapshot.projects.find((item) => item.id === projectId);
    body =
      project === undefined ? (
        <ProjectsView
          snapshot={snapshot}
          selectedProjectId={null}
          selectProject={(id) =>
            props.navigate({ area: "projects", projectId: id, tab: "overview" })
          }
          command={props.command}
        />
      ) : route.tab === "overview" ? (
        <ProjectOverview snapshot={snapshot} project={project} />
      ) : route.tab === "board" || route.tab === "table" ? (
        <BoardView
          snapshot={snapshot}
          projectId={project.id}
          command={props.command}
          mode={route.tab}
        />
      ) : route.tab === "meetings" ? (
        <MeetingsView
          snapshot={snapshot}
          projectId={project.id}
          command={props.command}
          onStart={startMeeting}
          onStop={stopMeeting}
          onOpen={(meeting) =>
            props.navigate({ area: "meetings", meetingId: meeting.id })
          }
        />
      ) : route.tab === "library" ? (
        <LibraryView
          snapshot={snapshot}
          projectId={project.id}
          command={props.command}
          onOpenItem={(libraryId) => props.navigate({ area: "library", libraryId })}
        />
      ) : (
        <ProjectMembersView
          snapshot={snapshot}
          projectId={project.id}
          command={props.command}
        />
      );
  } else if (route.area === "meetings") {
    const meetingId = route.meetingId;
    const meeting = snapshot.meetings.find((item) => item.id === meetingId);
    body =
      meeting === undefined ? (
        <MeetingsView
          snapshot={snapshot}
          projectId={null}
          command={props.command}
          onStart={startMeeting}
          onStop={stopMeeting}
          onOpen={(item) =>
            props.navigate({ area: "meetings", meetingId: item.id })
          }
        />
      ) : (
        <MeetingDetail
          snapshot={snapshot}
          meeting={meeting}
          command={props.command}
          navigate={props.navigate}
          onStop={stopMeeting}
        />
      );
  } else if (route.area === "library")
    body = (
      <LibraryView
        snapshot={snapshot}
        projectId={null}
        command={props.command}
        openItemId={route.libraryId}
        onOpenItem={(libraryId) => props.navigate({ area: "library", libraryId })}
      />
    );
  else if (route.area === "my")
    body =
      route.tab === "calendar" ? (
        <CalendarView
          snapshot={snapshot}
          projectId={null}
          personId={selectedPersonId}
          command={props.command}
        />
      ) : (
        <BoardView
          snapshot={snapshot}
          projectId={null}
          personId={selectedPersonId}
          command={props.command}
          mode={route.tab === "tasks" ? "table" : "board"}
          personal
        />
      );
  else
    body =
      route.tab === "people" ? (
        <PeopleView snapshot={snapshot} command={props.command} />
      ) : (
        <TeamsView snapshot={snapshot} command={props.command} />
      );
  return (
    <ConfigProvider theme={flowboardTheme}>
      <AntdApp component={false}>
        <div className={css.workspace}>
          <Sidebar
            state={state}
            navigate={props.navigate}
            selectPerson={props.selectPerson}
          />
          <div
            className={css.mainPane}
            data-project={selectedProject === undefined ? "false" : "true"}
          >
            <ProjectHeader
              project={selectedProject}
              route={route}
              state={state}
              navigate={props.navigate}
              refresh={props.refresh}
              viewTitle={viewTitle}
            />
            {state.error !== null && (
              <div className={css.errorBanner}>{state.error}</div>
            )}
            <main className={css.workspaceContent}>
              {state.busy && <div className={css.progress} />}
              {body}
            </main>
          </div>
        </div>
      </AntdApp>
    </ConfigProvider>
  );
}

export function FlowboardMeetingDock(
  props: PropsRuntime<"conversation.input.dock"> &
    InjectFace<FlowboardInjected>,
) {
  const state = props.useFlowboard((value) => value);
  const sessionId = String(props.sessionId);
  const stoppingRef = useRef(false);
  const runtime = state.meetingRuntimes[sessionId];
  const meeting = state.snapshot?.meetings.find(
    (item) => item.id === runtime?.meetingId,
  );
  const binding = state.snapshot?.meetingAgentBindings.find(
    (item) => item.meetingId === meeting?.id && item.sessionId === sessionId,
  );
  const pendingIntents =
    state.snapshot?.meetingIntents.filter(
      (item) =>
        item.meetingId === meeting?.id &&
        !["applied", "superseded", "rejected"].includes(item.status),
    ).length ?? 0;
  const active = meeting?.status === "live";
  const onSegment = useCallback(
    async (blob: Blob, startedAt: string, endedAt: string) => {
      if (meeting === undefined) return;
      props.setMeetingRuntime(sessionId, { uploading: true, error: null });
      try {
        const result = await props.upload(
          meeting.id,
          blob,
          crypto.randomUUID(),
          startedAt,
          endedAt,
        );
        const text = result.text?.trim();
        if (text !== undefined && text !== "") {
          props.setMeetingRuntime(sessionId, { candidate: text });
        }
      } finally {
        props.setMeetingRuntime(sessionId, { uploading: false });
      }
    },
    [meeting, props, sessionId],
  );
  const { stopSegment } = useVadRecorder({
    active,
    onSegment,
    onState: (recording) => props.setMeetingRuntime(sessionId, { recording }),
    onError: (error) => props.setMeetingRuntime(sessionId, { error }),
  });
  useEffect(() => {
    if (runtime?.stopping !== true || meeting === undefined || meeting.status !== "live" || stoppingRef.current) return;
    stoppingRef.current = true;
    void (async () => {
      try {
        await stopSegment();
        const latestMeeting = props.getState().snapshot?.meetings.find(
          (item) => item.id === meeting.id,
        );
        if (latestMeeting === undefined) throw new Error("会议状态已失效");
        await props.command({
          type: "meeting.update",
          expectedVersion: latestMeeting.version,
          payload: { id: meeting.id, status: "finalizing" },
        });
        props.setMeetingRuntime(sessionId, { stopping: false, recording: false });
      } catch (error) {
        props.setMeetingRuntime(sessionId, {
          stopping: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        stoppingRef.current = false;
      }
    })();
  }, [meeting, props, runtime?.stopping, sessionId, stopSegment]);
  if (meeting === undefined || runtime === undefined) return null;
  return (
    <div className={css.meetingDock}>
      <span className={active ? css.liveDot : css.finalizingDot} />{" "}
      <strong>{meeting.title}</strong>
      <span>
        {active
          ? runtime.stopping
            ? "正在完成最后转写"
            : runtime.recording
            ? "正在听取发言"
            : runtime.uploading
              ? "正在转写"
              : "AI 秘书在线"
          : "AI 正在整理"}
      </span>
      <p>{runtime.candidate || "转录会持续写入会议稿，由 Supervisor 统一分析"}</p>
      <span className={css.meetingAgentProgress}>
        {binding === undefined
          ? "AI 正在连接"
          : binding.deliveredSequence > binding.analyzedSequence
            ? `AI 正在分析 ${binding.deliveredSequence - binding.analyzedSequence} 条`
            : "AI 已追平"}
        {binding !== undefined ? ` · ${binding.analyzedSequence}/${binding.deliveredSequence}` : ""}
        {pendingIntents > 0 ? ` · ${pendingIntents} 个意图待处理` : ""}
      </span>
      {runtime.error !== null && <em>{runtime.error}</em>}
      {active && (
        <Button
          danger
          type="primary"
          size="middle"
          className={css.endMeetingButton!}
          icon={<StopOutlined />}
          disabled={runtime.stopping}
          onClick={() => props.setMeetingRuntime(sessionId, { stopping: true, error: null })}
        >
          结束会议
        </Button>
      )}
    </div>
  );
}
