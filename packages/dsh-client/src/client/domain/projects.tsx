import { useState } from "react";
import {
  Button,
  IconEditOutline16,
  IconPlusOutline16,
  IconTrashOutline16,
  IconUserOutline16,
  Input,
  TextArea,
} from "../ui.tsx";
import type { FlowboardSnapshot, ProjectView } from "@flowboard/contracts";
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
  | { type: "create" }
  | { type: "edit" | "member" | "delete"; project: ProjectView }
  | null;

export function ProjectsView({
  snapshot,
  selectedProjectId,
  selectProject,
  command,
}: {
  snapshot: FlowboardSnapshot;
  selectedProjectId: string | null;
  selectProject: (id: string) => void;
  command: CommandHandler;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  return (
    <section>
      <PageHeader
        title="项目"
        meta={`${snapshot.projects.length} 个可访问项目`}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<IconPlusOutline16 />}
            onClick={() => setDialog({ type: "create" })}
          >
            新建项目
          </Button>
        }
      />
      <div className={css.projectList}>
        {snapshot.projects.map((project) => {
          const members = snapshot.projectMembers.filter(
            (item) => item.projectId === project.id,
          );
          return (
            <article
              className={`${css.projectRow} ${selectedProjectId === project.id ? css.selectedRow : ""}`}
              key={project.id}
            >
              <button
                className={css.rowMain}
                type="button"
                onClick={() => selectProject(project.id)}
              >
                <strong>{project.name}</strong>
                <span>{project.description || "暂无描述"}</span>
              </button>
              <div className={css.rowMeta}>
                <span>{members.length} 位成员</span>
                <span>
                  {project.role === "owner" ? "负责人" : project.role}
                </span>
              </div>
              <div className={css.rowActions}>
                <IconButton
                  label="管理成员"
                  onClick={() => setDialog({ type: "member", project })}
                >
                  <IconUserOutline16 />
                </IconButton>
                <IconButton
                  label="编辑项目"
                  onClick={() => setDialog({ type: "edit", project })}
                >
                  <IconEditOutline16 />
                </IconButton>
                <IconButton
                  label="删除项目"
                  onClick={() => setDialog({ type: "delete", project })}
                >
                  <IconTrashOutline16 />
                </IconButton>
              </div>
            </article>
          );
        })}
      </div>
      {snapshot.projects.length === 0 && (
        <div className={css.empty}>
          <strong>还没有项目</strong>
          <span>创建项目后即可组织任务、会议与资料。</span>
        </div>
      )}

      <EntityModal
        open={dialog?.type === "create"}
        title="新建项目"
        submitLabel="创建"
        onClose={() => setDialog(null)}
        onSubmit={async (data) =>
          command({
            type: "project.create",
            payload: {
              teamId: String(data.get("teamId")),
              key: String(data.get("key")),
              name: String(data.get("name")),
              description: String(data.get("description") ?? ""),
            },
          })
        }
      >
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
        <Field label="项目 Key" hint="2-12 位英文或数字，例如 FLOW">
          <Input name="key" required maxLength={12} />
        </Field>
        <Field label="项目名称">
          <Input name="name" required autoFocus maxLength={240} />
        </Field>
        <Field label="项目描述">
          <TextArea name="description" rows={4} maxLength={2000} />
        </Field>
      </EntityModal>
      {dialog?.type === "edit" && (
        <EntityModal
          open
          title="编辑项目"
          submitLabel="保存"
          onClose={() => setDialog(null)}
          onSubmit={async (data) =>
            command({
              type: "project.update",
              expectedVersion: dialog.project.version,
              payload: {
                id: dialog.project.id,
                name: String(data.get("name")),
                description: String(data.get("description") ?? ""),
              },
            })
          }
        >
          <Field label="项目名称">
            <Input
              name="name"
              required
              autoFocus
              maxLength={240}
              defaultValue={dialog.project.name}
            />
          </Field>
          <Field label="项目描述">
            <TextArea
              name="description"
              rows={4}
              maxLength={2000}
              defaultValue={dialog.project.description}
            />
          </Field>
        </EntityModal>
      )}
      {dialog?.type === "member" && (
        <EntityModal
          open
          title={`管理成员 · ${dialog.project.name}`}
          submitLabel="保存权限"
          onClose={() => setDialog(null)}
          onSubmit={async (data) =>
            command({
              type: "project.member.set",
              payload: {
                projectId: dialog.project.id,
                userId: String(data.get("userId")),
                role: String(data.get("role")) as
                  "owner" | "admin" | "member" | "viewer",
              },
            })
          }
        >
          <Field label="成员">
            <SelectControl
              name="userId"
              ariaLabel="成员"
              defaultValue={snapshot.people[0]?.id}
              options={snapshot.people.map((person) => ({
                value: person.id,
                label: person.name,
                ...(person.email === null ? {} : { meta: person.email }),
              }))}
            />
          </Field>
          <Field label="项目权限">
            <SelectControl
              name="role"
              ariaLabel="项目权限"
              defaultValue="member"
              options={[
                { value: "viewer", label: "只读" },
                { value: "member", label: "成员" },
                { value: "admin", label: "管理员" },
                { value: "owner", label: "负责人" },
              ]}
            />
          </Field>
        </EntityModal>
      )}
      {dialog?.type === "delete" && (
        <ConfirmDialog
          open
          title="删除项目"
          detail={`确定删除“${dialog.project.name}”吗？项目内的任务、会议、资料和日程会同时删除，此操作无法撤销。`}
          onClose={() => setDialog(null)}
          onConfirm={async () =>
            command({
              type: "project.delete",
              expectedVersion: dialog.project.version,
              payload: { id: dialog.project.id },
            })
          }
        />
      )}
    </section>
  );
}
