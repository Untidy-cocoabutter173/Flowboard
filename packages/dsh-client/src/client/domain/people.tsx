import { useMemo, useState } from "react";
import { Avatar, Progress, Table, Tag, type TableColumnsType } from "antd";
import {
  Button,
  IconEditOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  Input,
} from "../ui.tsx";
import type { FlowboardSnapshot, PersonView } from "@flowboard/contracts";
import {
  ConfirmDialog,
  EntityModal,
  Field,
  IconButton,
  PageHeader,
  SelectControl,
  type CommandHandler,
} from "./shared.tsx";
import css from "../flowboard.module.css";

type Dialog =
  { type: "create" } | { type: "edit" | "delete"; person: PersonView } | null;

export function PeopleView({
  snapshot,
  command,
}: {
  snapshot: FlowboardSnapshot;
  command: CommandHandler;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [query, setQuery] = useState("");
  const people = useMemo(
    () =>
      snapshot.people.filter((person) =>
        `${person.name} ${person.email ?? ""} ${person.department ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [query, snapshot.people],
  );
  const editor = dialog?.type === "edit" ? dialog.person : undefined;
  const columns: TableColumnsType<PersonView> = [
    {
      title: "成员",
      key: "person",
      render: (_, person) => (
        <div className={css.personIdentity}>
          <Avatar>{person.name.slice(0, 1).toUpperCase()}</Avatar>
          <span>
            <strong>{person.name}</strong>
            <small>{person.email || "未设置邮箱"}</small>
          </span>
        </div>
      ),
    },
    {
      title: "部门 / 职位",
      key: "department",
      width: 180,
      render: (_, person) => (
        <span className={css.secondaryCell}>
          {person.department || "未设置"} · {person.title || "成员"}
        </span>
      ),
    },
    {
      title: "参与范围",
      key: "scope",
      width: 150,
      render: (_, person) => {
        const projects = new Set(
          snapshot.projectMembers
            .filter((member) => member.userId === person.id)
            .map((member) => member.projectId),
        ).size;
        const teams = new Set(
          snapshot.teamMembers
            .filter((member) => member.userId === person.id)
            .map((member) => member.teamId),
        ).size;
        return (
          <span className={css.scopeTags}>
            <Tag>{projects} 个项目</Tag>
            <Tag>{teams} 个团队</Tag>
          </span>
        );
      },
    },
    {
      title: "任务负载",
      key: "tasks",
      width: 210,
      render: (_, person) => {
        const tasks = snapshot.tasks.filter(
          (task) => task.assigneeId === person.id,
        );
        const completed = tasks.filter((task) => task.progress >= 1).length;
        return (
          <div className={css.memberProgress}>
            <Progress
              percent={tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100)}
              size="small"
              showInfo={false}
            />
            <span>{completed}/{tasks.length} 已完成</span>
          </div>
        );
      },
    },
    {
      title: "",
      key: "actions",
      width: 80,
      align: "right",
      render: (_, person) => (
        <div className={css.rowActions}>
          <IconButton
            label="编辑人员"
            onClick={() => setDialog({ type: "edit", person })}
          >
            <IconEditOutline16 />
          </IconButton>
          <IconButton
            label="删除人员"
            disabled={person.id === snapshot.actor.id}
            onClick={() => setDialog({ type: "delete", person })}
          >
            <IconTrashOutline16 />
          </IconButton>
        </div>
      ),
    },
  ];
  return (
    <section>
      <PageHeader
        title="人员管理"
        meta={`${snapshot.people.length} 位组织成员`}
        actions={
          <>
            <Input
              className={css.searchInput!}
              icon={<IconSearchOutline16 />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索成员"
              aria-label="搜索成员"
            />
            <Button
              variant="primary"
              size="sm"
              icon={<IconPlusOutline16 />}
              onClick={() => setDialog({ type: "create" })}
            >
              添加成员
            </Button>
          </>
        }
      />
      <Table<PersonView>
        className={css.frameworkTable!}
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={people}
        pagination={false}
        scroll={{ x: 860 }}
        locale={{ emptyText: query === "" ? "还没有成员" : "没有匹配的成员" }}
      />
      {(dialog?.type === "create" || dialog?.type === "edit") && (
        <EntityModal
          open
          title={editor === undefined ? "添加成员" : "编辑人员"}
          submitLabel="保存"
          onClose={() => setDialog(null)}
          onSubmit={async (data) => {
            const payload = {
              name: String(data.get("name")),
              email: String(data.get("email") ?? "").trim() || null,
              department: String(data.get("department") ?? "").trim() || null,
              title: String(data.get("title") ?? "").trim() || null,
            };
            if (editor === undefined)
              await command({
                type: "person.create",
                payload: {
                  teamId: String(data.get("teamId")),
                  name: payload.name,
                  ...(payload.email === null ? {} : { email: payload.email }),
                  ...(payload.department === null
                    ? {}
                    : { department: payload.department }),
                  ...(payload.title === null ? {} : { title: payload.title }),
                },
              });
            else
              await command({
                type: "person.update",
                expectedVersion: editor.version,
                payload: { id: editor.id, ...payload },
              });
          }}
        >
          {editor === undefined && (
            <Field label="所属团队">
              <SelectControl
                name="teamId"
                ariaLabel="所属团队"
                defaultValue={snapshot.teams[0]?.id}
                options={snapshot.teams.map((team) => ({
                  value: team.id,
                  label: team.name,
                }))}
              />
            </Field>
          )}
          <Field label="姓名">
            <Input
              name="name"
              required
              autoFocus
              maxLength={240}
              defaultValue={editor?.name}
            />
          </Field>
          <div className={css.formGrid}>
            <Field label="邮箱">
              <Input
                name="email"
                type="email"
                defaultValue={editor?.email ?? ""}
              />
            </Field>
            <Field label="部门">
              <Input
                name="department"
                defaultValue={editor?.department ?? ""}
              />
            </Field>
            <Field label="职位">
              <Input name="title" defaultValue={editor?.title ?? ""} />
            </Field>
          </div>
        </EntityModal>
      )}
      {dialog?.type === "delete" && (
        <ConfirmDialog
          open
          title="删除人员"
          detail={`确定删除“${dialog.person.name}”吗？其历史任务会保留但不再可分配新任务。`}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            command({
              type: "person.delete",
              expectedVersion: dialog.person.version,
              payload: { id: dialog.person.id },
            })
          }
        />
      )}
    </section>
  );
}
