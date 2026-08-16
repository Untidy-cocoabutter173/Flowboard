import { useMemo, useState } from "react";
import { Avatar, Button, Table, Tag, type TableColumnsType } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  TeamOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import type {
  AccessRole,
  FlowboardSnapshot,
  PersonView,
  TeamView,
} from "@flowboard/contracts";
import { Input, TextArea } from "../ui.tsx";
import {
  ConfirmDialog,
  Empty,
  EntityModal,
  Field,
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
const roleColor: Record<AccessRole, string> = {
  owner: "purple",
  admin: "blue",
  member: "green",
  viewer: "default",
};

type Dialog =
  | { type: "create" }
  | { type: "edit" | "delete"; team: TeamView }
  | { type: "add-member"; team: TeamView }
  | { type: "remove-member"; team: TeamView; person: PersonView }
  | null;

export function TeamsView({
  snapshot,
  command,
}: {
  snapshot: FlowboardSnapshot;
  command: CommandHandler;
}) {
  const [selectedId, setSelectedId] = useState(snapshot.teams[0]?.id ?? null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const selected =
    snapshot.teams.find((team) => team.id === selectedId) ?? snapshot.teams[0];
  const memberships =
    selected === undefined
      ? []
      : snapshot.teamMembers.filter((member) => member.teamId === selected.id);
  const memberIds = new Set(memberships.map((member) => member.userId));
  const members = snapshot.people.filter((person) => memberIds.has(person.id));
  const candidates = snapshot.people.filter(
    (person) => !memberIds.has(person.id),
  );
  const canManage = selected?.role === "owner" || selected?.role === "admin";

  const columns = useMemo<TableColumnsType<PersonView>>(
    () => [
      {
        title: "成员",
        key: "person",
        render: (_, person) => (
          <div className={css.personIdentity}>
            <Avatar>{person.name.slice(0, 1).toUpperCase()}</Avatar>
            <span>
              <strong>{person.name}</strong>
              <small>{person.email || person.title || "团队成员"}</small>
            </span>
          </div>
        ),
      },
      {
        title: "部门 / 职位",
        key: "department",
        render: (_, person) => (
          <span className={css.secondaryCell}>
            {person.department || "未设置"} · {person.title || "成员"}
          </span>
        ),
      },
      {
        title: "团队角色",
        key: "role",
        width: 150,
        render: (_, person) => {
          const membership = memberships.find(
            (member) => member.userId === person.id,
          );
          const role = membership?.role ?? "viewer";
          return canManage ? (
            <SelectControl
              ariaLabel={`${person.name}的团队角色`}
              value={role}
              onValueChange={(next) =>
                void command({
                  type: "team.member.set",
                  payload: {
                    teamId: selected!.id,
                    userId: person.id,
                    role: next as AccessRole,
                  },
                }).catch(() => undefined)
              }
              options={Object.entries(roleText).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          ) : (
            <Tag color={roleColor[role]}>{roleText[role]}</Tag>
          );
        },
      },
      {
        title: "参与项目",
        key: "projects",
        width: 100,
        render: (_, person) =>
          `${new Set(snapshot.projectMembers.filter((member) => member.userId === person.id).map((member) => member.projectId)).size} 个`,
      },
      {
        title: "",
        key: "actions",
        width: 52,
        align: "right",
        render: (_, person) => (
          <Button
            type="text"
            danger
            size="small"
            aria-label="移出团队"
            disabled={!canManage}
            icon={<DeleteOutlined />}
            onClick={() =>
              setDialog({ type: "remove-member", team: selected!, person })
            }
          />
        ),
      },
    ],
    [canManage, command, memberships, selected, snapshot.projectMembers],
  );

  const teamEditor = dialog?.type === "edit" ? dialog.team : undefined;
  return (
    <section>
      <PageHeader
        title="团队管理"
        meta={`${snapshot.teams.length} 个团队 · 组织权限与成员范围`}
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setDialog({ type: "create" })}
          >
            新建团队
          </Button>
        }
      />
      <div className={css.teamWorkspace}>
        <aside className={css.teamRail}>
          {snapshot.teams.map((team) => (
            <button
              type="button"
              key={team.id}
              data-active={team.id === selected?.id}
              onClick={() => setSelectedId(team.id)}
            >
              <span className={css.teamGlyph}>
                <TeamOutlined />
              </span>
              <span>
                <strong>{team.name}</strong>
                <small>
                  {
                    snapshot.teamMembers.filter(
                      (member) => member.teamId === team.id,
                    ).length
                  }{" "}
                  位成员
                </small>
              </span>
              <Tag color={roleColor[team.role]}>{roleText[team.role]}</Tag>
            </button>
          ))}
          {snapshot.teams.length === 0 && <Empty title="还没有团队" />}
        </aside>
        <div className={css.teamPanel}>
          {selected !== undefined && (
            <>
              <header>
                <div>
                  <h3>{selected.name}</h3>
                  <p>{selected.description || "暂无团队说明"}</p>
                </div>
                <div>
                  <Button
                    size="small"
                    icon={<UserAddOutlined />}
                    disabled={!canManage || candidates.length === 0}
                    onClick={() =>
                      setDialog({ type: "add-member", team: selected })
                    }
                  >
                    添加成员
                  </Button>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    disabled={!canManage}
                    onClick={() => setDialog({ type: "edit", team: selected })}
                  >
                    编辑
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={!canManage}
                    onClick={() =>
                      setDialog({ type: "delete", team: selected })
                    }
                  >
                    删除
                  </Button>
                </div>
              </header>
              <Table<PersonView>
                rowKey="id"
                size="middle"
                columns={columns}
                dataSource={members}
                pagination={false}
                locale={{ emptyText: "团队还没有成员" }}
              />
            </>
          )}
        </div>
      </div>

      {(dialog?.type === "create" || dialog?.type === "edit") && (
        <EntityModal
          open
          title={teamEditor === undefined ? "新建团队" : "编辑团队"}
          submitLabel="保存"
          onClose={() => setDialog(null)}
          onSubmit={(data) =>
            teamEditor === undefined
              ? command({
                  type: "team.create",
                  payload: {
                    name: String(data.get("name")),
                    description: String(data.get("description") ?? ""),
                  },
                })
              : command({
                  type: "team.update",
                  expectedVersion: teamEditor.version,
                  payload: {
                    id: teamEditor.id,
                    name: String(data.get("name")),
                    description: String(data.get("description") ?? ""),
                  },
                })
          }
        >
          <Field label="团队名称">
            <Input
              name="name"
              required
              autoFocus
              defaultValue={teamEditor?.name}
            />
          </Field>
          <Field label="团队说明">
            <TextArea
              name="description"
              rows={4}
              defaultValue={teamEditor?.description}
            />
          </Field>
        </EntityModal>
      )}
      {dialog?.type === "add-member" && (
        <EntityModal
          open
          title={`添加到 ${dialog.team.name}`}
          submitLabel="添加成员"
          onClose={() => setDialog(null)}
          onSubmit={(data) =>
            command({
              type: "team.member.set",
              payload: {
                teamId: dialog.team.id,
                userId: String(data.get("userId")),
                role: String(data.get("role")) as AccessRole,
              },
            })
          }
        >
          <Field label="组织人员">
            <SelectControl
              name="userId"
              ariaLabel="组织人员"
              defaultValue={candidates[0]?.id}
              options={candidates.map((person) => ({
                value: person.id,
                label: person.name,
                meta: person.department ?? undefined,
              }))}
            />
          </Field>
          <Field label="团队角色">
            <SelectControl
              name="role"
              ariaLabel="团队角色"
              defaultValue="member"
              options={Object.entries(roleText).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Field>
        </EntityModal>
      )}
      {dialog?.type === "delete" && (
        <ConfirmDialog
          open
          title="删除团队"
          detail={`确定删除“${dialog.team.name}”吗？仍拥有项目的团队不能删除。`}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            command({
              type: "team.delete",
              expectedVersion: dialog.team.version,
              payload: { id: dialog.team.id },
            })
          }
        />
      )}
      {dialog?.type === "remove-member" && (
        <ConfirmDialog
          open
          title="移出团队"
          detail={`确定将“${dialog.person.name}”移出“${dialog.team.name}”吗？该团队下的项目成员关系也会移除。`}
          confirmLabel="移出"
          onClose={() => setDialog(null)}
          onConfirm={() =>
            command({
              type: "team.member.remove",
              payload: { teamId: dialog.team.id, userId: dialog.person.id },
            })
          }
        />
      )}
    </section>
  );
}
