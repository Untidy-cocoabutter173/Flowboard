import { useMemo, useState, type CSSProperties, type DragEvent } from 'react'
import { Button, IconEditOutline16, IconPlusOutline16, IconSearchOutline16, IconTrashOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FieldType, FlowboardSnapshot, JsonValue, Priority, TaskFieldDefinitionView, TaskView } from '@flowboard/contracts'
import { MarkdownEditor } from './markdown.tsx'
import { ConfirmDialog, Empty, EntityModal, Field, IconButton, PageHeader, formatDate, localDateTime, toIso, type CommandHandler } from './shared.tsx'
import css from '../flowboard.module.css'

type TaskDialog = { type: 'create' } | { type: 'edit' | 'delete' | 'markdown'; task: TaskView } | null
type FieldDialog = { type: 'create' } | { type: 'edit' | 'delete'; field: TaskFieldDefinitionView } | null
type WorkflowDialog = { type: 'create' } | { type: 'edit' | 'delete'; status: FlowboardSnapshot['workflowStatuses'][number] } | null
type GroupBy = 'none' | 'status' | 'priority' | 'assignee' | 'category' | 'project'
type TaskUpdatePayload = Omit<Extract<Parameters<CommandHandler>[0], { type: 'task.update' }>['payload'], 'id'>

const priorityText: Record<Priority, string> = { low: '低', medium: '中', high: '高', urgent: '紧急' }
const fieldTypeText: Record<FieldType, string> = { text: '文本', number: '数字', boolean: '勾选', date: '日期', select: '单选', multi_select: '多选', person: '人员' }

function optionList(value: FormDataEntryValue | null): string[] {
  return [...new Set(String(value ?? '').split(/[\n,，]/).map(item => item.trim()).filter(Boolean))]
}

function MultiSelectCell({ label, options, value, save }: { label: string; options: string[]; value: string[]; save(value: string[]): void }) {
  const [selected, setSelected] = useState(value)
  return <details className={css.multiSelectCell}><summary aria-label={label}>{selected.length === 0 ? <span>未设置</span> : selected.slice(0, 2).map(item => <i key={item}>{item}</i>)}</summary><div>{options.map(option => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={event => setSelected(current => event.target.checked ? [...current, option] : current.filter(item => item !== option))} />{option}</label>)}<Button type="button" variant="primary" size="sm" onClick={event => { save(selected); (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open') }}>完成</Button></div></details>
}

export function BoardView({ snapshot, projectId, command, mode = 'board', personal = false }: { snapshot: FlowboardSnapshot; projectId: string | null; command: CommandHandler; mode?: 'board' | 'table'; personal?: boolean }) {
  const [dialog, setDialog] = useState<TaskDialog>(null)
  const [fieldDialog, setFieldDialog] = useState<FieldDialog>(null)
  const [workflowDialog, setWorkflowDialog] = useState<WorkflowDialog>(null)
  const [query, setQuery] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>(mode === 'board' ? (personal ? 'project' : 'status') : 'none')
  const [createProjectId, setCreateProjectId] = useState(projectId ?? snapshot.projects[0]?.id ?? '')
  const projectIds = new Set(snapshot.projects.map(project => project.id))
  const tasks = useMemo(() => snapshot.tasks.filter(task => (personal ? task.assigneeId === snapshot.actor.id : task.projectId === projectId) && `${task.title} ${task.summary}`.toLowerCase().includes(query.trim().toLowerCase())), [personal, projectId, query, snapshot.actor.id, snapshot.tasks])
  const activeProjectId = projectId ?? (personal ? (createProjectId || snapshot.projects[0]?.id || null) : null)
  const customFields = personal ? [] : snapshot.fieldDefinitions.filter(field => field.projectId === activeProjectId).sort((a, b) => a.position - b.position)
  const projectMembers = (id: string) => {
    const ids = new Set(snapshot.projectMembers.filter(item => item.projectId === id).map(item => item.userId))
    return snapshot.people.filter(person => ids.has(person.id))
  }
  const statusesFor = (id: string) => snapshot.workflowStatuses.filter(status => status.projectId === id).sort((a, b) => a.position - b.position)
  if (activeProjectId === null && !personal) return <Empty title="请先创建项目" detail="任务看板需要归属到一个项目。" />

  const updateTask = (task: TaskView, payload: TaskUpdatePayload) => command({ type: 'task.update', expectedVersion: task.version, payload: { id: task.id, ...payload } })
  const parseCustomFields = (data: FormData, project: string): Record<string, JsonValue> => Object.fromEntries(snapshot.fieldDefinitions.filter(field => field.projectId === project).map(field => {
    const name = `custom:${field.key}`
    if (field.type === 'multi_select') return [field.key, data.getAll(name).map(String)]
    if (field.type === 'boolean') return [field.key, data.get(name) === 'on']
    const raw = String(data.get(name) ?? '').trim()
    if (raw === '') return [field.key, null]
    if (field.type === 'number') return [field.key, Number(raw)]
    return [field.key, raw]
  }))
  const submitTask = async (data: FormData, task?: TaskView) => {
    const selectedProject = task?.projectId ?? String(data.get('projectId') || activeProjectId)
    const dueAt = toIso(data.get('dueAt')); const assigneeId = String(data.get('assigneeId') ?? '')
    const categoryId = String(data.get('categoryId') ?? '')
    const common = { title: String(data.get('title')), summary: String(data.get('summary') ?? ''), detail: String(data.get('detail') ?? ''), statusId: String(data.get('statusId')), priority: String(data.get('priority')) as Priority, progress: Number(data.get('progress')) / 100, customData: parseCustomFields(data, selectedProject), meetingIds: data.getAll('meetingIds').map(String), libraryItemIds: data.getAll('libraryItemIds').map(String) }
    if (task === undefined) await command({ type: 'task.create', payload: { projectId: selectedProject, ...common, ...(assigneeId === '' ? {} : { assigneeId }), ...(categoryId === '' ? {} : { categoryId }), ...(dueAt === undefined ? {} : { dueAt }) } })
    else await updateTask(task, { ...common, assigneeId: assigneeId || null, categoryId: categoryId || null, dueAt: dueAt ?? null })
  }

  const groupLabel = (task: TaskView, grouping: GroupBy): { id: string; label: string; color?: string } => {
    if (grouping === 'status') { const status = snapshot.workflowStatuses.find(item => item.id === task.statusId); return { id: task.statusId, label: status?.name ?? '未知状态', ...(status?.color === undefined ? {} : { color: status.color }) } }
    if (grouping === 'priority') return { id: task.priority, label: `${priorityText[task.priority]}优先级` }
    if (grouping === 'assignee') return { id: task.assigneeId ?? 'none', label: snapshot.people.find(item => item.id === task.assigneeId)?.name ?? '未指派' }
    if (grouping === 'category') return { id: task.categoryId ?? 'none', label: snapshot.categories.find(item => item.id === task.categoryId)?.name ?? '未分组' }
    if (grouping === 'project') { const project = snapshot.projects.find(item => item.id === task.projectId); return { id: task.projectId, label: project?.name ?? '未知项目', ...(project?.color === undefined ? {} : { color: project.color }) } }
    return { id: 'all', label: '全部任务' }
  }
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; label: string; color?: string; tasks: TaskView[] }>()
    const add = (id: string, label: string, color?: string) => map.set(id, { id, label, ...(color === undefined ? {} : { color }), tasks: [] })
    if (groupBy === 'status' && !personal && activeProjectId !== null) statusesFor(activeProjectId).forEach(item => add(item.id, item.name, item.color))
    if (groupBy === 'priority') (['urgent', 'high', 'medium', 'low'] as Priority[]).forEach(item => add(item, `${priorityText[item]}优先级`))
    if (groupBy === 'assignee') { add('none', '未指派'); (personal ? snapshot.people : projectMembers(activeProjectId ?? '')).forEach(item => add(item.id, item.name)) }
    if (groupBy === 'category') { add('none', '未分组'); snapshot.categories.forEach(item => add(item.id, item.name, item.color)) }
    if (groupBy === 'project') snapshot.projects.filter(project => projectIds.has(project.id)).forEach(item => add(item.id, item.name, item.color))
    if (groupBy === 'none') add('all', '全部任务')
    for (const task of tasks) { const group = groupLabel(task, groupBy); if (!map.has(group.id)) add(group.id, group.label, group.color); map.get(group.id)?.tasks.push(task) }
    return [...map.values()]
  }, [activeProjectId, groupBy, personal, snapshot.categories, snapshot.people, snapshot.projects, snapshot.workflowStatuses, tasks])
  const dropTask = (event: DragEvent, groupId: string) => {
    event.preventDefault(); const task = tasks.find(item => item.id === event.dataTransfer.getData('text/flowboard-task'))
    if (task === undefined) return
    const payload = groupBy === 'status' ? { statusId: groupId } : groupBy === 'priority' ? { priority: groupId as Priority } : groupBy === 'assignee' ? { assigneeId: groupId === 'none' ? null : groupId } : groupBy === 'category' ? { categoryId: groupId === 'none' ? null : groupId } : null
    if (payload !== null) void updateTask(task, payload).catch(() => undefined)
  }

  const taskCard = (task: TaskView) => {
    const project = snapshot.projects.find(item => item.id === task.projectId); const assignee = snapshot.people.find(person => person.id === task.assigneeId); const category = snapshot.categories.find(item => item.id === task.categoryId)
    return <article className={css.task} key={task.id} draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/flowboard-task', task.id) }}><div className={css.taskTop}><span className={css.issueKey}>{project?.key}-{task.sequence}</span><span className={`${css.priority} ${css[`priority_${task.priority}`]}`}>{priorityText[task.priority]}</span></div><button className={css.taskTitle} type="button" onClick={() => setDialog({ type: 'markdown', task })}>{task.title}</button>{task.summary !== '' && <p>{task.summary}</p>}{category !== undefined && <span className={css.categoryTag}><i style={{ background: category.color }} />{category.name}</span>}<div className={css.taskProgress}><i style={{ width: `${Math.round(task.progress * 100)}%` }} /></div><div className={css.taskMeta}><span className={css.avatar}>{assignee?.name.slice(0, 1) ?? '?'}</span><span>{assignee?.name ?? '未指派'}</span><span>{Math.round(task.progress * 100)}%</span></div><footer><span>{task.dueAt === null ? '未设截止' : formatDate(task.dueAt, false)}</span><div className={css.rowActions}><IconButton label="编辑任务" onClick={() => setDialog({ type: 'edit', task })}><IconEditOutline16 /></IconButton><IconButton label="删除任务" onClick={() => setDialog({ type: 'delete', task })}><IconTrashOutline16 /></IconButton></div></footer></article>
  }

  const customCell = (task: TaskView, field: TaskFieldDefinitionView) => {
    const value = task.customData[field.key]
    const save = (next: JsonValue) => void updateTask(task, { customData: { ...task.customData, [field.key]: next } }).catch(() => undefined)
    if (field.type === 'boolean') return <label className={css.checkboxCell}><input type="checkbox" checked={value === true} onChange={event => save(event.target.checked)} /><span>{value === true ? '是' : '否'}</span></label>
    if (field.type === 'select') return <select aria-label={field.name} value={typeof value === 'string' ? value : ''} onChange={event => save(event.target.value || null)}><option value="">未设置</option>{field.options.map(option => <option key={option}>{option}</option>)}</select>
    if (field.type === 'multi_select') return <MultiSelectCell label={field.name} options={field.options} value={Array.isArray(value) ? value.map(String) : []} save={save} />
    if (field.type === 'person') return <select aria-label={field.name} value={typeof value === 'string' ? value : ''} onChange={event => save(event.target.value || null)}><option value="">未设置</option>{projectMembers(task.projectId).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
    return <input aria-label={field.name} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} defaultValue={value === null || value === undefined || Array.isArray(value) ? '' : String(value)} onBlur={event => { const raw = event.target.value.trim(); const next: JsonValue = raw === '' ? null : field.type === 'number' ? Number(raw) : raw; if (next !== value) save(next) }} />
  }

  const tableTemplate = `${personal ? '130px ' : ''}minmax(280px,2fr) 130px 120px 110px 120px 120px 160px${customFields.map(() => ' minmax(150px,1fr)').join('')}`
  const tableStyle = { gridTemplateColumns: tableTemplate } as CSSProperties
  const taskRow = (task: TaskView) => {
    const project = snapshot.projects.find(item => item.id === task.projectId); const statuses = statusesFor(task.projectId); const members = projectMembers(task.projectId)
    return <div className={css.taskGridRow} style={tableStyle} key={task.id}>{personal && <span className={css.projectCell}><i style={{ background: project?.color }} />{project?.name}</span>}<div className={css.titleCell}><button type="button" onClick={() => setDialog({ type: 'markdown', task })}>{project?.key}-{task.sequence}</button><input aria-label="任务标题" defaultValue={task.title} onBlur={event => { const title = event.target.value.trim(); if (title !== '' && title !== task.title) void updateTask(task, { title }).catch(() => undefined) }} /></div><select aria-label="状态" value={task.statusId} onChange={event => void updateTask(task, { statusId: event.target.value }).catch(() => undefined)}>{statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}</select><select aria-label="负责人" value={task.assigneeId ?? ''} onChange={event => void updateTask(task, { assigneeId: event.target.value || null }).catch(() => undefined)}><option value="">未指派</option>{members.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select><select aria-label="优先级" value={task.priority} onChange={event => void updateTask(task, { priority: event.target.value as Priority }).catch(() => undefined)}>{Object.entries(priorityText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="分组" value={task.categoryId ?? ''} onChange={event => void updateTask(task, { categoryId: event.target.value || null }).catch(() => undefined)}><option value="">未分组</option>{snapshot.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select><div className={css.progressCell}><input aria-label="进度" type="number" min="0" max="100" step="5" defaultValue={Math.round(task.progress * 100)} onBlur={event => { const progress = Math.max(0, Math.min(100, Number(event.target.value))) / 100; if (progress !== task.progress) void updateTask(task, { progress }).catch(() => undefined) }} /><span>%</span></div><input aria-label="截止时间" type="datetime-local" defaultValue={localDateTime(task.dueAt)} onBlur={event => { const dueAt = event.target.value === '' ? null : new Date(event.target.value).toISOString(); if (dueAt !== task.dueAt) void updateTask(task, { dueAt }).catch(() => undefined) }} />{customFields.map(field => <div className={css.customCell} key={field.id}>{customCell(task, field)}</div>)}</div>
  }

  const editor = dialog?.type === 'edit' ? dialog.task : undefined
  const editorProject = editor?.projectId ?? (createProjectId || activeProjectId || '')
  const editorFields = snapshot.fieldDefinitions.filter(field => field.projectId === editorProject).sort((a, b) => a.position - b.position)
  const linkedMeetingIds = new Set(editor === undefined ? [] : snapshot.links.taskMeetings.filter(link => link.taskId === editor.id).map(link => link.meetingId))
  const linkedLibraryIds = new Set(editor === undefined ? [] : snapshot.links.taskLibrary.filter(link => link.taskId === editor.id).map(link => link.libraryItemId))
  const projectMeetingIds = new Set(snapshot.links.projectMeetings.filter(link => link.projectId === editorProject).map(link => link.meetingId))
  const projectLibraryIds = new Set(snapshot.links.projectLibrary.filter(link => link.projectId === editorProject).map(link => link.libraryItemId))
  const fieldEditor = fieldDialog?.type === 'edit' ? fieldDialog.field : undefined
  const statusEditor = workflowDialog?.type === 'edit' ? workflowDialog.status : undefined
  const multiDefault = (field: TaskFieldDefinitionView): string[] => {
    const value = editor?.customData[field.key]
    return Array.isArray(value) ? value.map(String) : []
  }

  return <section className={css.taskWorkspace}><PageHeader title={personal ? (mode === 'table' ? '我的任务' : '我的看板') : mode === 'table' ? '任务表' : 'Jira 看板'} meta={`${tasks.length} 项工作`} actions={<><Input className={css.searchInput!} icon={<IconSearchOutline16 />} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索任务" aria-label="搜索任务" /><label className={css.groupControl}><span>分组</span><select value={groupBy} onChange={event => setGroupBy(event.target.value as GroupBy)}><option value="none">不分组</option><option value="status">状态</option><option value="priority">优先级</option><option value="assignee">负责人</option><option value="category">分类</option>{personal && <option value="project">项目</option>}</select></label>{mode === 'table' && !personal && <Button variant="outline" size="sm" icon={<IconPlusOutline16 />} onClick={() => setFieldDialog({ type: 'create' })}>添加字段</Button>}{mode === 'board' && !personal && groupBy === 'status' && <Button variant="outline" size="sm" icon={<IconPlusOutline16 />} onClick={() => setWorkflowDialog({ type: 'create' })}>添加状态</Button>}<Button variant="primary" size="sm" icon={<IconPlusOutline16 />} disabled={activeProjectId === null} onClick={() => { setCreateProjectId(activeProjectId ?? ''); setDialog({ type: 'create' }) }}>新建任务</Button></>} />
    {mode === 'board' ? <div className={css.board}>{groups.map(group => <section className={css.column} key={group.id} onDragOver={event => { if (groupBy !== 'project' && groupBy !== 'none') event.preventDefault() }} onDrop={event => dropTask(event, group.id)}><header style={{ borderTopColor: group.color ?? '#8A8D93' }}><div><h3>{group.label}</h3><span>{group.tasks.length}</span></div>{groupBy === 'status' && !personal && <IconButton label="编辑状态" onClick={() => { const status = snapshot.workflowStatuses.find(item => item.id === group.id); if (status !== undefined) setWorkflowDialog({ type: 'edit', status }) }}><IconEditOutline16 /></IconButton>}</header><div className={css.taskList}>{group.tasks.map(taskCard)}{group.tasks.length === 0 && <div className={css.columnEmpty}>拖动任务到这里</div>}</div></section>)}</div> : <div className={css.dataTable}><div className={css.taskGridHead} style={tableStyle}>{personal && <span>项目</span>}<span>任务</span><span>状态</span><span>负责人</span><span>优先级</span><span>分组</span><span>进度</span><span>截止时间</span>{customFields.map(field => <button type="button" key={field.id} onClick={() => setFieldDialog({ type: 'edit', field })}><span>{field.name}</span><small>{fieldTypeText[field.type]}</small><IconEditOutline16 /></button>)}</div>{groups.map(group => <div key={group.id}>{groupBy !== 'none' && <div className={css.tableGroup}><i style={{ background: group.color ?? '#8A8D93' }} /><strong>{group.label}</strong><span>{group.tasks.length}</span></div>}{group.tasks.map(taskRow)}</div>)}</div>}
    {tasks.length === 0 && <Empty title="没有符合条件的任务" />}

    {(dialog?.type === 'create' || dialog?.type === 'edit') && <EntityModal open title={editor === undefined ? '新建任务' : '编辑任务'} submitLabel={editor === undefined ? '创建' : '保存'} onClose={() => setDialog(null)} onSubmit={data => submitTask(data, editor)}><div className={css.formGrid}>{personal && editor === undefined && <Field label="所属项目"><select name="projectId" required value={createProjectId} onChange={event => setCreateProjectId(event.target.value)}>{snapshot.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>}<Field label="任务标题"><Input name="title" required autoFocus maxLength={240} defaultValue={editor?.title} /></Field><Field label="工作流状态"><select name="statusId" defaultValue={editor?.statusId ?? statusesFor(editorProject)[0]?.id}>{statusesFor(editorProject).map(status => <option value={status.id} key={status.id}>{status.name}</option>)}</select></Field><Field label="负责人"><select name="assigneeId" defaultValue={editor?.assigneeId ?? ''}><option value="">未指派</option>{projectMembers(editorProject).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field><Field label="优先级"><select name="priority" defaultValue={editor?.priority ?? 'medium'}>{Object.entries(priorityText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="分组"><select name="categoryId" defaultValue={editor?.categoryId ?? ''}><option value="">未分组</option>{snapshot.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><Field label="完成进度"><input name="progress" type="number" min="0" max="100" step="5" defaultValue={Math.round((editor?.progress ?? 0) * 100)} /></Field><Field label="截止时间"><input name="dueAt" type="datetime-local" defaultValue={localDateTime(editor?.dueAt ?? null)} /></Field></div><Field label="摘要"><Input name="summary" maxLength={1000} defaultValue={editor?.summary} /></Field><Field label="Markdown 详情"><textarea name="detail" rows={6} defaultValue={editor?.detail} /></Field>{editorFields.length > 0 && <div className={css.customFieldForm}><h3>自定义字段</h3><div className={css.formGrid}>{editorFields.map(field => <Field key={field.id} label={field.name}>{field.type === 'multi_select' ? <select name={`custom:${field.key}`} multiple defaultValue={multiDefault(field)}>{field.options.map(option => <option key={option}>{option}</option>)}</select> : field.type === 'select' ? <select name={`custom:${field.key}`} defaultValue={String(editor?.customData[field.key] ?? '')}><option value="">未设置</option>{field.options.map(option => <option key={option}>{option}</option>)}</select> : field.type === 'person' ? <select name={`custom:${field.key}`} defaultValue={String(editor?.customData[field.key] ?? '')}><option value="">未设置</option>{projectMembers(editorProject).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select> : field.type === 'boolean' ? <input name={`custom:${field.key}`} type="checkbox" defaultChecked={editor?.customData[field.key] === true} /> : <input name={`custom:${field.key}`} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} required={field.required} defaultValue={String(editor?.customData[field.key] ?? '')} />}</Field>)}</div></div>}<div className={css.formGrid}><Field label="关联会议"><select name="meetingIds" multiple defaultValue={[...linkedMeetingIds]}>{snapshot.meetings.filter(item => projectMeetingIds.has(item.id)).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field><Field label="关联资料"><select name="libraryItemIds" multiple defaultValue={[...linkedLibraryIds]}>{snapshot.library.filter(item => projectLibraryIds.has(item.id)).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field></div></EntityModal>}
    {dialog?.type === 'markdown' && <MarkdownEditor open title={dialog.task.title} fileName={`${snapshot.projects.find(item => item.id === dialog.task.projectId)?.key}-${dialog.task.sequence}.md`} value={dialog.task.detail} onClose={() => setDialog(null)} onSave={detail => updateTask(dialog.task, { detail })} />}
    {dialog?.type === 'delete' && <ConfirmDialog open title="删除任务" detail={`确定删除“${dialog.task.title}”吗？`} onClose={() => setDialog(null)} onConfirm={() => command({ type: 'task.delete', expectedVersion: dialog.task.version, payload: { id: dialog.task.id } })} />}

    {(fieldDialog?.type === 'create' || fieldDialog?.type === 'edit') && <EntityModal open title={fieldEditor === undefined ? '添加字段' : '编辑字段'} submitLabel="保存字段" onClose={() => setFieldDialog(null)} onSubmit={data => { const fieldType = String(data.get('fieldType')) as FieldType; const payload = { name: String(data.get('name')), fieldType, required: data.get('required') === 'on', options: optionList(data.get('options')) }; return fieldEditor === undefined ? command({ type: 'field.create', payload: { projectId: activeProjectId!, key: `field_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`, ...payload } }) : command({ type: 'field.update', expectedVersion: fieldEditor.version, payload: { id: fieldEditor.id, ...payload } }) }}><div className={css.formGrid}><Field label="字段名称"><Input name="name" required autoFocus defaultValue={fieldEditor?.name} /></Field><Field label="字段类型"><select name="fieldType" defaultValue={fieldEditor?.type ?? 'text'}>{Object.entries(fieldTypeText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div><Field label="选项"><textarea name="options" rows={4} defaultValue={fieldEditor?.options.join('\n')} /></Field><label className={css.toggleField}><input name="required" type="checkbox" defaultChecked={fieldEditor?.required} /><span>必填字段</span></label>{fieldEditor !== undefined && <Button type="button" variant="ghost" className={css.inlineDanger} onClick={() => setFieldDialog({ type: 'delete', field: fieldEditor })}>删除字段</Button>}</EntityModal>}
    {fieldDialog?.type === 'delete' && <ConfirmDialog open title="删除字段" detail={`确定删除“${fieldDialog.field.name}”吗？所有任务中的该字段值也会删除。`} onClose={() => setFieldDialog(null)} onConfirm={() => command({ type: 'field.delete', expectedVersion: fieldDialog.field.version, payload: { id: fieldDialog.field.id } })} />}

    {(workflowDialog?.type === 'create' || workflowDialog?.type === 'edit') && <EntityModal open title={statusEditor === undefined ? '添加状态' : '编辑状态'} submitLabel="保存状态" onClose={() => setWorkflowDialog(null)} onSubmit={data => { const payload = { name: String(data.get('name')), color: String(data.get('color')), category: String(data.get('category')) as 'backlog' | 'active' | 'done' }; return statusEditor === undefined ? command({ type: 'workflow.create', payload: { projectId: activeProjectId!, ...payload } }) : command({ type: 'workflow.update', expectedVersion: statusEditor.version, payload: { id: statusEditor.id, ...payload } }) }}><div className={css.formGrid}><Field label="状态名称"><Input name="name" required autoFocus defaultValue={statusEditor?.name} /></Field><Field label="颜色"><input name="color" type="color" defaultValue={statusEditor?.color ?? '#4D6BFE'} /></Field></div><Field label="状态类别"><select name="category" defaultValue={statusEditor?.category ?? 'active'}><option value="backlog">待办</option><option value="active">进行中</option><option value="done">已完成</option></select></Field>{statusEditor !== undefined && <Button type="button" variant="ghost" className={css.inlineDanger} onClick={() => setWorkflowDialog({ type: 'delete', status: statusEditor })}>删除状态</Button>}</EntityModal>}
    {workflowDialog?.type === 'delete' && <ConfirmDialog open title="删除状态" detail={`确定删除“${workflowDialog.status.name}”吗？使用中的状态不能删除。`} onClose={() => setWorkflowDialog(null)} onConfirm={() => command({ type: 'workflow.delete', expectedVersion: workflowDialog.status.version, payload: { id: workflowDialog.status.id } })} />}
  </section>
}
