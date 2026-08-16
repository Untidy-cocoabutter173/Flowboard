import { useMemo, useState } from "react";
import { Avatar, Progress, Table, type TableColumnsType } from "antd";
import {
  Button,
  IconPlusOutline16,
  IconTrashOutline16,
} from "../ui.tsx";
import type { AccessRole, FlowboardSnapshot } from "@flowboard/contracts";
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

const roleText: Record<AccessRole, string> = {
  owner: "负责人",
  admin: "管理员",
  member: "成员",
  viewer: "只读",
};

export function ProjectMembersView({
  snapshot,
  projectId,
  command,
}: {
  snapshot: FlowboardSnapshot;
  projectId: string;
  command: CommandHandler;
}) {
  const project = snapshot.projects.find((item) => item.id === projectId);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const memberships = snapshot.projectMembers.filter(
    (item) => item.projectId === projectId,
  );
  const memberIds = new Set(memberships.map((item) => item.userId));
  const members = snapshot.people.filter((person) => memberIds.has(person.id));
  const candidates = useMemo(() => {
    if (project === undefined) return [];
    const teamPeople = new Set(
      snapshot.teamMembers
        .filter((item) => item.teamId === project.teamId)
        .map((item) => item.userId),
    );
    return snapshot.people.filter(
      (person) => teamPeople.has(person.id) && !memberIds.has(person.id),
    );
  }, [memberIds, project, snapshot.people, snapshot.teamMembers]);
  const canManage = project?.role === "owner" || project?.role === "admin";
  const removingPerson = snapshot.people.find(
    (person) => person.id === removing,
  );
  const columns: TableColumnsType<(typeof members)[number]> = [
    {
      title: "成员",
      key: "person",
      render: (_, person) => (
        <div className={css.personIdentity}>
          <Avatar>{person.name.slice(0, 1).toUpperCase()}</Avatar>
          <span>
            <strong>{person.name}</strong>
            <small>{person.title || person.email || "项目成员"}</small>
          </span>
        </div>
      ),
    },
    {
      title: "项目角色",
      key: "role",
      width: 150,
      render: (_, person) => {
        const membership = memberships.find(
          (item) => item.userId === person.id,
        );
        return (
          <SelectControl
            className={css.roleSelect}
            ariaLabel={`${person.name}的项目角色`}
            value={membership?.role ?? "member"}
            disabled={!canManage}
            onValueChange={(value) =>
              void command({
                type: "project.member.set",
                payload: {
                  projectId,
                  userId: person.id,
                  role: value as AccessRole,
                },
              }).catch(() => undefined)
            }
            options={Object.entries(roleText).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        );
      },
    },
    {
      title: "任务完成",
      key: "tasks",
      width: 240,
      render: (_, person) => {
        const tasks = snapshot.tasks.filter(
          (task) =>
            task.projectId === projectId && task.assigneeId === person.id,
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
      width: 52,
      align: "right",
      render: (_, person) => (
        <IconButton
          label="移出项目"
          disabled={!canManage}
          onClick={() => setRemoving(person.id)}
        >
          <IconTrashOutline16 />
        </IconButton>
      ),
    },
  ];
  return (
    <section>
      <PageHeader
        title="项目成员"
        meta={`${members.length} 位成员 · 任务负责人仅从此列表选择`}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<IconPlusOutline16 />}
            disabled={!canManage || candidates.length === 0}
            onClick={() => setAdding(true)}
          >
            添加成员
          </Button>
        }
      />
      <Table<(typeof members)[number]>
        className={css.frameworkTable!}
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={members}
        pagination={false}
        scroll={{ x: 760 }}
        locale={{ emptyText: "项目还没有成员" }}
      />
      <EntityModal
        open={adding}
        title="添加项目成员"
        submitLabel="添加"
        onClose={() => setAdding(false)}
        onSubmit={(data) =>
          command({
            type: "project.member.set",
            payload: {
              projectId,
              userId: String(data.get("userId")),
              role: String(data.get("role")) as AccessRole,
            },
          })
        }
      >
        <Field label="团队成员">
          <SelectControl
            name="userId"
            ariaLabel="团队成员"
            defaultValue={candidates[0]?.id}
            options={candidates.map((person) => ({
              value: person.id,
              label: person.name,
              meta: person.department || "未设置部门",
            }))}
          />
        </Field>
        <Field label="项目角色">
          <SelectControl
            name="role"
            ariaLabel="项目角色"
            defaultValue="member"
            options={Object.entries(roleText).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Field>
      </EntityModal>
      <ConfirmDialog
        open={removing !== null}
        title="移出项目"
        detail={`确定将“${removingPerson?.name ?? ""}”移出当前项目吗？其历史任务仍会保留。`}
        confirmLabel="移出"
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          command({
            type: "project.member.remove",
            payload: { projectId, userId: removing! },
          })
        }
      />
    </section>
  );
}
