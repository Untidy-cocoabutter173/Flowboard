import { useMemo, useState } from "react";
import {
  Button,
  IconEditOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  Input,
} from "../ui.tsx";
import type {
  CalendarEventType,
  CalendarEventView,
  FlowboardSnapshot,
} from "@flowboard/contracts";
import {
  ConfirmDialog,
  DateTimeControl,
  Empty,
  EntityModal,
  Field,
  IconButton,
  PageHeader,
  SelectControl,
  formatDate,
  toIso,
  type CommandHandler,
} from "./shared.tsx";
import css from "../flowboard.module.css";

type Dialog =
  | { type: "create" }
  | { type: "edit" | "delete"; event: CalendarEventView }
  | null;
const typeText: Record<CalendarEventType, string> = {
  meeting: "会议",
  deadline: "截止",
  event: "日程",
  reminder: "提醒",
};

export function CalendarView({
  snapshot,
  projectId,
  personId = null,
  command,
}: {
  snapshot: FlowboardSnapshot;
  projectId: string | null;
  personId?: string | null;
  command: CommandHandler;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [createProjectId, setCreateProjectId] = useState(
    projectId ?? snapshot.projects[0]?.id ?? "",
  );
  const events = useMemo(
    () =>
      snapshot.events
        .filter((item) =>
          projectId === null
            ? item.ownerId === personId ||
              item.attendeeIds.includes(personId ?? "")
            : item.projectId === projectId,
        )
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [personId, projectId, snapshot.events],
  );
  const editor = dialog?.type === "edit" ? dialog.event : undefined;
  const submit = async (data: FormData) => {
    const startAt = toIso(data.get("startAt"));
    if (startAt === undefined) throw new Error("请选择开始时间");
    const endAt = toIso(data.get("endAt"));
    const common = {
      title: String(data.get("title")),
      type: String(data.get("type")) as CalendarEventType,
      startAt,
    };
    const targetProjectId =
      projectId ?? String(data.get("projectId") || createProjectId);
    if (targetProjectId === "") throw new Error("请选择所属项目");
    if (editor === undefined)
      await command({
        type: "event.create",
        payload: {
          projectId: targetProjectId,
          ...common,
          ...(personId === null ? {} : { ownerId: personId }),
          ...(endAt === undefined ? {} : { endAt }),
        },
      });
    else
      await command({
        type: "event.update",
        expectedVersion: editor.version,
        payload: { id: editor.id, ...common, endAt: endAt ?? null },
      });
  };
  const person = snapshot.people.find((item) => item.id === personId);
  return (
    <section>
      <PageHeader
        title={
          projectId === null
            ? `${person?.name ?? "当前人员"}的日程`
            : "项目日程"
        }
        meta={`${events.length} 项安排`}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<IconPlusOutline16 />}
            disabled={snapshot.projects.length === 0}
            onClick={() => setDialog({ type: "create" })}
          >
            新建日程
          </Button>
        }
      />
      <div className={css.timeline}>
        {events.map((event) => (
          <article className={css.eventRow} key={event.id}>
            <time dateTime={event.startAt}>
              <strong>{new Date(event.startAt).getDate()}</strong>
              <span>
                {new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(
                  new Date(event.startAt),
                )}
              </span>
            </time>
            <i className={css.eventLine} data-type={event.type} />
            <div className={css.rowMain}>
              <strong>{event.title}</strong>
              <span>
                {formatDate(event.startAt)}
                {event.endAt === null ? "" : ` - ${formatDate(event.endAt)}`}
              </span>
            </div>
            <span className={css.typeLabel}>{typeText[event.type]}</span>
            <div className={css.rowActions}>
              <IconButton
                label="编辑日程"
                onClick={() => setDialog({ type: "edit", event })}
              >
                <IconEditOutline16 />
              </IconButton>
              <IconButton
                label="删除日程"
                onClick={() => setDialog({ type: "delete", event })}
              >
                <IconTrashOutline16 />
              </IconButton>
            </div>
          </article>
        ))}
      </div>
      {events.length === 0 && (
        <Empty title="还没有日程" detail="可安排会议、截止时间和提醒。" />
      )}
      {(dialog?.type === "create" || dialog?.type === "edit") && (
        <EntityModal
          open
          title={editor === undefined ? "新建日程" : "编辑日程"}
          submitLabel={editor === undefined ? "创建" : "保存"}
          onClose={() => setDialog(null)}
          onSubmit={submit}
        >
          {projectId === null && editor === undefined && (
            <Field label="所属项目">
              <SelectControl
                name="projectId"
                ariaLabel="所属项目"
                value={createProjectId}
                onValueChange={setCreateProjectId}
                options={snapshot.projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                }))}
              />
            </Field>
          )}
          <Field label="标题">
            <Input
              name="title"
              required
              autoFocus
              maxLength={240}
              defaultValue={editor?.title}
            />
          </Field>
          <div className={css.formGrid}>
            <Field label="类型">
              <SelectControl
                name="type"
                ariaLabel="日程类型"
                defaultValue={editor?.type ?? "event"}
                options={Object.entries(typeText).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Field>
            <Field label="开始时间">
              <DateTimeControl
                name="startAt"
                ariaLabel="开始时间"
                defaultValue={editor?.startAt ?? null}
              />
            </Field>
            <Field label="结束时间">
              <DateTimeControl
                name="endAt"
                ariaLabel="结束时间"
                defaultValue={editor?.endAt ?? null}
              />
            </Field>
          </div>
        </EntityModal>
      )}
      {dialog?.type === "delete" && (
        <ConfirmDialog
          open
          title="删除日程"
          detail={`确定删除“${dialog.event.title}”吗？`}
          onClose={() => setDialog(null)}
          onConfirm={async () =>
            command({
              type: "event.delete",
              expectedVersion: dialog.event.version,
              payload: { id: dialog.event.id },
            })
          }
        />
      )}
    </section>
  );
}
