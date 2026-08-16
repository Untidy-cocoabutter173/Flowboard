import { useMemo, useState } from 'react'
import { Button, IconEditOutline16, IconPlusOutline16, IconSearchOutline16, IconTrashOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FlowboardSnapshot, PersonView } from '@flowboard/contracts'
import { ConfirmDialog, Empty, EntityModal, Field, IconButton, PageHeader, type CommandHandler } from './shared.tsx'
import css from '../flowboard.module.css'

type Dialog = { type: 'create' } | { type: 'edit' | 'delete'; person: PersonView } | null

export function PeopleView({ snapshot, command }: { snapshot: FlowboardSnapshot; command: CommandHandler }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const [query, setQuery] = useState('')
  const people = useMemo(() => snapshot.people.filter(person => `${person.name} ${person.email ?? ''} ${person.department ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [query, snapshot.people])
  const editor = dialog?.type === 'edit' ? dialog.person : undefined
  return <section><PageHeader title="人员管理" meta={`${snapshot.people.length} 位组织成员`} actions={<><Input className={css.searchInput!} icon={<IconSearchOutline16 />} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索成员" aria-label="搜索成员" /><Button variant="primary" size="sm" icon={<IconPlusOutline16 />} onClick={() => setDialog({ type: 'create' })}>添加成员</Button></>} />
    <div className={css.peopleTable}><div className={css.peopleTableHead}><span>成员</span><span>部门 / 职位</span><span>参与项目</span><span>负责任务</span><span>团队</span><span /></div>{people.map(person => {
      const projectIds = new Set(snapshot.projectMembers.filter(member => member.userId === person.id).map(member => member.projectId))
      const teamIds = new Set(snapshot.teamMembers.filter(member => member.userId === person.id).map(member => member.teamId))
      const tasks = snapshot.tasks.filter(task => task.assigneeId === person.id)
      return <article key={person.id}><div className={css.personIdentity}><i>{person.name.slice(0, 1).toUpperCase()}</i><span><strong>{person.name}</strong><small>{person.email || '未设置邮箱'}</small></span></div><span>{person.department || '未设置'} · {person.title || '成员'}</span><span>{projectIds.size} 个项目</span><span>{tasks.length} 项 · {tasks.filter(task => task.progress >= 1).length} 已完成</span><span>{teamIds.size} 个团队</span><div className={css.rowActions}><IconButton label="编辑人员" onClick={() => setDialog({ type: 'edit', person })}><IconEditOutline16 /></IconButton><IconButton label="删除人员" disabled={person.id === snapshot.actor.id} onClick={() => setDialog({ type: 'delete', person })}><IconTrashOutline16 /></IconButton></div></article>
    })}</div>
    {people.length === 0 && <Empty title={query === '' ? '还没有成员' : '没有匹配的成员'} />}
    {(dialog?.type === 'create' || dialog?.type === 'edit') && <EntityModal open title={editor === undefined ? '添加成员' : '编辑人员'} submitLabel="保存" onClose={() => setDialog(null)} onSubmit={async data => { const payload = { name: String(data.get('name')), email: String(data.get('email') ?? '').trim() || null, department: String(data.get('department') ?? '').trim() || null, title: String(data.get('title') ?? '').trim() || null }; if (editor === undefined) await command({ type: 'person.create', payload: { teamId: String(data.get('teamId')), name: payload.name, ...(payload.email === null ? {} : { email: payload.email }), ...(payload.department === null ? {} : { department: payload.department }), ...(payload.title === null ? {} : { title: payload.title }) } }); else await command({ type: 'person.update', expectedVersion: editor.version, payload: { id: editor.id, ...payload } }) }}>{editor === undefined && <Field label="所属团队"><select name="teamId" required>{snapshot.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field>}<Field label="姓名"><Input name="name" required autoFocus maxLength={240} defaultValue={editor?.name} /></Field><div className={css.formGrid}><Field label="邮箱"><Input name="email" type="email" defaultValue={editor?.email ?? ''} /></Field><Field label="部门"><Input name="department" defaultValue={editor?.department ?? ''} /></Field><Field label="职位"><Input name="title" defaultValue={editor?.title ?? ''} /></Field></div></EntityModal>}
    {dialog?.type === 'delete' && <ConfirmDialog open title="删除人员" detail={`确定删除“${dialog.person.name}”吗？其历史任务会保留但不再可分配新任务。`} onClose={() => setDialog(null)} onConfirm={() => command({ type: 'person.delete', expectedVersion: dialog.person.version, payload: { id: dialog.person.id } })} />}
  </section>
}
