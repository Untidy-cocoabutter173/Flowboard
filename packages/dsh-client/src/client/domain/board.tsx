import { useMemo, useState } from 'react'
import { Button, IconEditOutline16, IconPlusOutline16, IconSearchOutline16, IconTrashOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FlowboardSnapshot, Priority, TaskView } from '@flowboard/contracts'
import { ConfirmDialog, Empty, EntityModal, Field, IconButton, PageHeader, formatDate, localDateTime, toIso, type CommandHandler } from './shared.tsx'
import css from '../flowboard.module.css'

type TaskDialog = { type: 'create' } | { type: 'edit' | 'delete'; task: TaskView } | null
const priorityText: Record<Priority, string> = { low: '低', medium: '中', high: '高' }

export function BoardView({ snapshot, projectId, command }: { snapshot: FlowboardSnapshot; projectId: string | null; command: CommandHandler }) {
  const [dialog, setDialog] = useState<TaskDialog>(null)
  const [query, setQuery] = useState('')
  const tasks = useMemo(() => snapshot.tasks.filter(task => task.projectId === projectId && `${task.title} ${task.summary}`.toLowerCase().includes(query.trim().toLowerCase())), [projectId, query, snapshot.tasks])
  if (projectId === null) return <Empty title="请先创建项目" detail="任务看板需要归属到一个项目。" />
  const submitTask = async (data: FormData, task?: TaskView) => {
    const dueAt = toIso(data.get('dueAt'))
    const categoryId = String(data.get('categoryId') ?? '')
    const assigneeId = String(data.get('assigneeId') ?? '')
    const common = {
      title: String(data.get('title')), summary: String(data.get('summary') ?? ''), detail: String(data.get('detail') ?? ''),
      columnId: String(data.get('columnId')), priority: String(data.get('priority')) as Priority, progress: Number(data.get('progress')) / 100,
    }
    if (task === undefined) await command({ type: 'task.create', payload: { projectId, ...common, ...(categoryId === '' ? {} : { categoryId }), ...(assigneeId === '' ? {} : { assigneeId }), ...(dueAt === undefined ? {} : { dueAt }) } })
    else await command({ type: 'task.update', expectedVersion: task.version, payload: { id: task.id, ...common, categoryId: categoryId || null, assigneeId: assigneeId || null, dueAt: dueAt ?? null } })
  }
  const editor = dialog?.type === 'edit' ? dialog.task : undefined
  return <section>
    <PageHeader title="任务看板" meta={`${tasks.length} 项工作`} actions={<><Input className={css.searchInput!} icon={<IconSearchOutline16 />} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索任务" aria-label="搜索任务" /><Button variant="primary" size="sm" icon={<IconPlusOutline16 />} onClick={() => setDialog({ type: 'create' })}>新建任务</Button></>} />
    <div className={css.board}>{snapshot.columns.map(column => {
      const columnTasks = tasks.filter(task => task.columnId === column.id)
      return <section className={css.column} key={column.id}><header><h3>{column.name}</h3><span>{columnTasks.length}</span></header><div className={css.taskList}>{columnTasks.map(task => {
        const assignee = snapshot.people.find(person => person.id === task.assigneeId)
        const category = snapshot.categories.find(item => item.id === task.categoryId)
        return <article className={css.task} key={task.id}><div className={css.taskTop}><span className={`${css.priority} ${css[`priority_${task.priority}`]}`}>{priorityText[task.priority]}</span><div className={css.rowActions}><IconButton label="编辑任务" onClick={() => setDialog({ type: 'edit', task })}><IconEditOutline16 /></IconButton><IconButton label="删除任务" onClick={() => setDialog({ type: 'delete', task })}><IconTrashOutline16 /></IconButton></div></div><strong>{task.title}</strong>{task.summary !== '' && <p>{task.summary}</p>}<div className={css.taskProgress}><i style={{ width: `${Math.round(task.progress * 100)}%` }} /></div><div className={css.taskMeta}><span>{assignee?.name ?? '未指派'}</span><span>{task.dueAt === null ? `${Math.round(task.progress * 100)}%` : formatDate(task.dueAt, false)}</span></div>{category !== undefined && <span className={css.category} style={{ '--category-color': category.color } as React.CSSProperties}>{category.name}</span>}<select className={css.moveSelect} aria-label={`移动任务 ${task.title}`} value={task.columnId} onChange={event => void command({ type: 'task.update', expectedVersion: task.version, payload: { id: task.id, columnId: event.target.value } }).catch(() => undefined)}>{snapshot.columns.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></article>
      })}{columnTasks.length === 0 && <div className={css.columnEmpty}>暂无任务</div>}</div></section>
    })}</div>
    {(dialog?.type === 'create' || dialog?.type === 'edit') && <EntityModal open title={editor === undefined ? '新建任务' : '编辑任务'} submitLabel={editor === undefined ? '创建' : '保存'} onClose={() => setDialog(null)} onSubmit={data => submitTask(data, editor)}>
      <div className={css.formGrid}><Field label="任务标题"><Input name="title" required autoFocus maxLength={240} defaultValue={editor?.title} /></Field><Field label="看板分组"><select name="columnId" defaultValue={editor?.columnId ?? snapshot.columns[0]?.id}>{snapshot.columns.map(column => <option value={column.id} key={column.id}>{column.name}</option>)}</select></Field><Field label="负责人"><select name="assigneeId" defaultValue={editor?.assigneeId ?? ''}><option value="">未指派</option>{snapshot.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field><Field label="分类"><select name="categoryId" defaultValue={editor?.categoryId ?? ''}><option value="">未分类</option>{snapshot.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><Field label="优先级"><select name="priority" defaultValue={editor?.priority ?? 'medium'}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></Field><Field label="完成进度"><input name="progress" type="number" min="0" max="100" step="5" defaultValue={Math.round((editor?.progress ?? 0) * 100)} /></Field><Field label="截止时间"><input name="dueAt" type="datetime-local" defaultValue={localDateTime(editor?.dueAt ?? null)} /></Field></div>
      <Field label="摘要"><Input name="summary" maxLength={1000} defaultValue={editor?.summary} /></Field><Field label="详细说明"><textarea name="detail" rows={5} defaultValue={editor?.detail} /></Field>
    </EntityModal>}
    {dialog?.type === 'delete' && <ConfirmDialog open title="删除任务" detail={`确定删除“${dialog.task.title}”吗？`} onClose={() => setDialog(null)} onConfirm={async () => command({ type: 'task.delete', expectedVersion: dialog.task.version, payload: { id: dialog.task.id } })} />}
  </section>
}
