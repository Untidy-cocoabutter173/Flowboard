import { useCallback, useEffect, useState } from "react";
import {
  App as AntdApp,
  Avatar,
  Badge,
  Button,
  ConfigProvider,
  Input,
  Menu,
  Tooltip,
  type MenuProps,
  type ThemeConfig,
} from "antd";
import {
  AppstoreOutlined,
  CalendarOutlined,
  DashboardOutlined,
  FileTextOutlined,
  HomeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  TeamOutlined,
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
import { MarkdownEditor } from "./domain/markdown.tsx";
import { MeetingsView } from "./domain/meetings.tsx";
import { PeopleView } from "./domain/people.tsx";
import { ProjectMembersView } from "./domain/project-members.tsx";
import { ProjectsView } from "./domain/projects.tsx";
import { TeamsView } from "./domain/teams.tsx";
import {
  Empty,
  EntityModal,
  Field,
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
        <Badge count={count} showZero overflowCount={999} size="small" />
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
  command,
  startMeeting,
  navigate,
}: {
  snapshot: FlowboardSnapshot;
  personId: string | null;
  command: (value: ClientCommand) => Promise<unknown>;
  startMeeting(meeting: MeetingView): Promise<void>;
  navigate(route: FlowboardRoute): void;
}) {
  const [create, setCreate] = useState(false);
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
  return (
    <section>
      <PageHeader
        title={`你好，${person?.name ?? snapshot.actor.name}`}
        meta="今天的任务、日程和项目进展"
        actions={
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            disabled={snapshot.projects.length === 0}
            onClick={() => setCreate(true)}
          >
            开始 AI 会议
          </Button>
        }
      />
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
      <EntityModal
        open={create}
        title="开始 AI 会议"
        submitLabel="创建并开始"
        onClose={() => setCreate(false)}
        onSubmit={async (data) => {
          const project = snapshot.projects.find(
            (item) => item.id === String(data.get("projectId")),
          );
          if (project === undefined) throw new Error("请选择项目");
          const result = (await command({
            type: "meeting.create",
            payload: {
              teamId: project.teamId,
              projectIds: [project.id],
              title: String(data.get("title")),
              settings: {
                automation: String(data.get("automation")) as
                  "record" | "suggest" | "execute",
                silenceSec: Number(data.get("silenceSec")),
              },
            },
          })) as { entityId: string };
          const meeting =
            snapshot.meetings.find((item) => item.id === result.entityId) ??
            ({ id: result.entityId, version: 1 } as MeetingView);
          await startMeeting(meeting);
        }}
      >
        <Field label="会议主题">
          <Input name="title" required autoFocus />
        </Field>
        <Field label="关联项目">
          <SelectControl
            name="projectId"
            ariaLabel="关联项目"
            defaultValue={snapshot.projects[0]?.id}
            options={snapshot.projects.map((project) => ({
              value: project.id,
              label: project.name,
              meta: project.key,
            }))}
          />
        </Field>
        <div className={css.formGrid}>
          <Field label="AI 参与">
            <SelectControl
              name="automation"
              ariaLabel="AI 参与模式"
              defaultValue="suggest"
              options={[
                { value: "record", label: "只记录" },
                { value: "suggest", label: "建议后执行" },
                { value: "execute", label: "自动执行安全操作" },
              ]}
            />
          </Field>
          <Field label="静音提交（秒）">
            <input
              name="silenceSec"
              type="number"
              min="1"
              max="30"
              defaultValue="4"
            />
          </Field>
        </div>
      </EntityModal>
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
}: {
  snapshot: FlowboardSnapshot;
  meeting: MeetingView;
  command(value: ClientCommand): Promise<unknown>;
  navigate(route: FlowboardRoute): void;
}) {
  const [editing, setEditing] = useState<"transcript" | "summary" | null>(null);
  const utterances = snapshot.utterances.filter(
    (item) => item.meetingId === meeting.id,
  );
  const actions = snapshot.aiActions.filter(
    (item) => item.meetingId === meeting.id,
  );
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
            <Button size="small" onClick={() => setEditing("transcript")}>
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
      <div className={css.meetingDetail}>
        <section>
          <h3>转录稿</h3>
          {utterances.map((item) => (
            <p key={item.id}>
              <time>#{item.sequence}</time>
              {item.text}
            </p>
          ))}
          {utterances.length === 0 && meeting.transcript !== "" && (
            <p>{meeting.transcript}</p>
          )}
          {utterances.length === 0 && meeting.transcript === "" && (
            <Empty title="等待会议转录" />
          )}
        </section>
        <aside>
          <h3>核心总结</h3>
          <p>{meeting.summary || "会议结束后由 AI 整理"}</p>
          <h3>决议</h3>
          {meeting.decisions.map((item) => (
            <p key={item}>{item}</p>
          ))}
          <h3>风险</h3>
          {meeting.risks.map((item) => (
            <p key={item}>{item}</p>
          ))}
          <h3>会议资料</h3>
          {snapshot.library
            .filter((item) => documents.has(item.id))
            .map((item) => (
              <button
                className={css.documentLink}
                type="button"
                key={item.id}
                onClick={() =>
                  navigate({ area: "library", libraryId: item.id })
                }
              >
                {item.title}
              </button>
            ))}
          <h3>AI 操作</h3>
          {actions.map((item) => (
            <p key={item.id}>{item.summary}</p>
          ))}
        </aside>
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
    await props.command({
      type: "meeting.update",
      expectedVersion: meeting.version,
      payload: { id: meeting.id, status: "live" },
    });
    props.setMeetingRuntime(sessionId, { meetingId: meeting.id, error: null });
    props.navigate({ area: "meetings", meetingId: meeting.id });
  };
  const stopMeeting = async (meeting: MeetingView) => {
    await props.command({
      type: "meeting.update",
      expectedVersion: meeting.version,
      payload: { id: meeting.id, status: "finalizing" },
    });
    const prompt = `会议 ${meeting.id} 已停止采集。请先调用 flowboard_snapshot 读取会议详情，等待最后转写完成，然后调用 flowboard_finalize_meeting 整理总结、决议、风险、行动项和会议资料。`;
    props.inputActions.setDraft(prompt);
    props.inputActions.submit();
  };
  let body;
  if (route.area === "home")
    body = (
      <Home
        snapshot={snapshot}
        personId={selectedPersonId}
        command={props.command}
        startMeeting={startMeeting}
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
        />
      );
  } else if (route.area === "library")
    body = (
      <LibraryView
        snapshot={snapshot}
        projectId={null}
        command={props.command}
        openItemId={route.libraryId}
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
  const runtime = state.meetingRuntimes[sessionId];
  const input = props.useInput((value) => value);
  const meeting = state.snapshot?.meetings.find(
    (item) => item.id === runtime?.meetingId,
  );
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
          const latest =
            props.getState().meetingRuntimes[sessionId]?.candidate ?? "";
          const candidate = latest === "" ? text : `${latest}\n${text}`;
          const currentDraft = input.draft.trim();
          props.inputActions.setDraft(
            currentDraft === "" ? candidate : `${input.draft}\n${text}`,
          );
          props.setMeetingRuntime(sessionId, {
            candidate,
            awaitingConsumption: false,
          });
        }
      } finally {
        props.setMeetingRuntime(sessionId, { uploading: false });
      }
    },
    [input.draft, meeting, props, sessionId],
  );
  useVadRecorder({
    active,
    onSegment,
    onState: (recording) => props.setMeetingRuntime(sessionId, { recording }),
    onError: (error) => props.setMeetingRuntime(sessionId, { error }),
  });
  useEffect(() => {
    if (
      runtime?.candidate === undefined ||
      runtime.candidate === "" ||
      runtime.awaitingConsumption ||
      input.phase !== "plain"
    )
      return;
    const timer = window.setTimeout(
      () => {
        props.setMeetingRuntime(sessionId, { awaitingConsumption: true });
        props.inputActions.submit();
      },
      (meeting?.settings.silenceSec ?? 4) * 1_000,
    );
    return () => window.clearTimeout(timer);
  }, [
    input.phase,
    meeting?.settings.silenceSec,
    props,
    runtime?.awaitingConsumption,
    runtime?.candidate,
    sessionId,
  ]);
  useEffect(() => {
    if (
      runtime?.awaitingConsumption === true &&
      input.draft === "" &&
      input.phase === "plain"
    )
      props.setMeetingRuntime(sessionId, {
        candidate: "",
        awaitingConsumption: false,
      });
  }, [
    input.draft,
    input.phase,
    props,
    runtime?.awaitingConsumption,
    sessionId,
  ]);
  if (meeting === undefined || runtime === undefined) return null;
  return (
    <div className={css.meetingDock}>
      <span className={active ? css.liveDot : css.finalizingDot} />{" "}
      <strong>{meeting.title}</strong>
      <span>
        {active
          ? runtime.recording
            ? "正在听取发言"
            : runtime.uploading
              ? "正在转写"
              : "AI 秘书在线"
          : "AI 正在整理"}
      </span>
      <p>{runtime.candidate || "转录内容会持续进入输入候选框"}</p>
      {runtime.error !== null && <em>{runtime.error}</em>}
      {active && (
        <Button
          size="small"
          icon={<StopOutlined />}
          onClick={() =>
            void props
              .command({
                type: "meeting.update",
                expectedVersion: meeting.version,
                payload: { id: meeting.id, status: "finalizing" },
              })
              .then(() => {
                const prompt = `会议 ${meeting.id} 已结束，请读取会议并调用 flowboard_finalize_meeting 完成整理。`;
                props.inputActions.setDraft(prompt);
                props.inputActions.submit();
              })
              .catch(() => undefined)
          }
        >
          停止
        </Button>
      )}
    </div>
  );
}
