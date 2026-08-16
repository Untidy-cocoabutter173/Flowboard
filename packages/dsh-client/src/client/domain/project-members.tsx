import { useMemo, useState } from 'react'
import { Button, IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccessRole, FlowboardSnapshot } from '@flowboard/contracts'
import { ConfirmDialog, Empty, EntityModal, Field, IconButton, PageHeader, type CommandHandler } from './shared.tsx'
import css from '../flowboard.module.css'

const roleText: Record<AccessRole, string> = { owner: '负责人', admin: '管理员', member: '成员', viewer: '只读' }

export function ProjectMembersView({ snapshot, projectId, command }: { snapshot: FlowboardSnapshot; projectId: string; command: CommandHandler }) {
  const project = snapshot.projects.find(item => item.id === projectId)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const memberships = snapshot.projectMembers.filter(item => item.projectId === projectId)
  const memberIds = new Set(memberships.map(item => item.userId))
  const members = snapshot.people.filter(person => memberIds.has(person.id))
  const candidates = useMemo(() => {
    if (project === undefined) return []
    const teamPeople = new Set(snapshot.teamMembers.filter(item => item.teamId === project.teamId).map(item => item.userId))
    return snapshot.people.filter(person => teamPeople.has(person.id) && !memberIds.has(person.id))
  }, [memberIds, project, snapshot.people, snapshot.teamMembers])
  const canManage = project?.role === 'owner' || project?.role === 'admin'
  const removingPerson = snapshot.people.find(person => person.id === removing)
  return <section><PageHeader title="项目成员" meta={`${members.length} 位成员 · 任务负责人仅从此列表选择`} actions={<Button variant="primary" size="sm" icon={<IconPlusOutline16 />} disabled={!canManage || candidates.length === 0} onClick={() => setAdding(true)}>添加成员</Button>} />
    <div className={css.projectMembersTable}><div className={css.tableHead}><span>成员</span><span>项目角色</span><span>负责任务</span><span>完成进度</span><span /></div>{members.map(person => {
      const membership = memberships.find(item => item.userId === person.id)
      const tasks = snapshot.tasks.filter(task => task.projectId === projectId && task.assigneeId === person.id)
      const completed = tasks.filter(task => task.progress >= 1).length
      return <article key={person.id}><div className={css.personIdentity}><i>{person.name.slice(0, 1).toUpperCase()}</i><span><strong>{person.name}</strong><small>{person.title || person.email || '项目成员'}</small></span></div><select aria-label={`${person.name}的项目角色`} value={membership?.role ?? 'member'} disabled={!canManage} onChange={event => void command({ type: 'project.member.set', payload: { projectId, userId: person.id, role: event.target.value as AccessRole } }).catch(() => undefined)}>{Object.entries(roleText).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select><span>{tasks.length} 项</span><span>{tasks.length === 0 ? '暂无任务' : `${completed}/${tasks.length} 已完成`}</span><IconButton label="移出项目" disabled={!canManage} onClick={() => setRemoving(person.id)}><IconTrashOutline16 /></IconButton></article>
    })}</div>
    {members.length === 0 && <Empty title="项目还没有成员" />}
    <EntityModal open={adding} title="添加项目成员" submitLabel="添加" onClose={() => setAdding(false)} onSubmit={data => command({ type: 'project.member.set', payload: { projectId, userId: String(data.get('userId')), role: String(data.get('role')) as AccessRole } })}><Field label="团队成员"><select name="userId" required>{candidates.map(person => <option key={person.id} value={person.id}>{person.name} · {person.department || '未设置部门'}</option>)}</select></Field><Field label="项目角色"><select name="role" defaultValue="member">{Object.entries(roleText).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></Field></EntityModal>
    <ConfirmDialog open={removing !== null} title="移出项目" detail={`确定将“${removingPerson?.name ?? ''}”移出当前项目吗？其历史任务仍会保留。`} confirmLabel="移出" onClose={() => setRemoving(null)} onConfirm={() => command({ type: 'project.member.remove', payload: { projectId, userId: removing! } })} />
  </section>
}
