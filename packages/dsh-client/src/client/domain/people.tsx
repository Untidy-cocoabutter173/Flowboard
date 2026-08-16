import { useMemo, useState } from 'react'
import { Button, IconPlusOutline16, IconSearchOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FlowboardSnapshot } from '@flowboard/contracts'
import { Empty, EntityModal, Field, PageHeader, type CommandHandler } from './shared.tsx'
import css from '../flowboard.module.css'

export function PeopleView({ snapshot, command }: { snapshot: FlowboardSnapshot; command: CommandHandler }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const people = useMemo(() => snapshot.people.filter(person => `${person.name} ${person.email ?? ''} ${person.department ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())), [query, snapshot.people])
  return <section><PageHeader title="成员" meta={`${snapshot.people.length} 位成员`} actions={<><Input className={css.searchInput!} icon={<IconSearchOutline16 />} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索成员" aria-label="搜索成员" /><Button variant="primary" size="sm" icon={<IconPlusOutline16 />} onClick={() => setOpen(true)}>添加成员</Button></>} />
    <div className={css.peopleTable}><div className={css.tableHead}><span>成员</span><span>部门</span><span>职位</span><span>邮箱</span></div>{people.map(person => <article key={person.id}><div className={css.personIdentity}><i>{person.name.slice(0, 1).toUpperCase()}</i><strong>{person.name}</strong></div><span>{person.department || '未设置'}</span><span>{person.title || '成员'}</span><span>{person.email || '未设置'}</span></article>)}</div>
    {people.length === 0 && <Empty title={query === '' ? '还没有成员' : '没有匹配的成员'} />}
    <EntityModal open={open} title="添加成员" submitLabel="添加" onClose={() => setOpen(false)} onSubmit={async data => command({ type: 'person.create', payload: { teamId: String(data.get('teamId')), name: String(data.get('name')), ...(String(data.get('email') ?? '').trim() === '' ? {} : { email: String(data.get('email')) }), ...(String(data.get('department') ?? '').trim() === '' ? {} : { department: String(data.get('department')) }), ...(String(data.get('title') ?? '').trim() === '' ? {} : { title: String(data.get('title')) }) } })}><Field label="所属团队"><select name="teamId" required>{snapshot.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field><Field label="姓名"><Input name="name" required autoFocus maxLength={240} /></Field><div className={css.formGrid}><Field label="邮箱"><Input name="email" type="email" /></Field><Field label="部门"><Input name="department" /></Field><Field label="职位"><Input name="title" /></Field></div></EntityModal>
  </section>
}
