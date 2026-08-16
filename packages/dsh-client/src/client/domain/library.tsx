import { useState } from 'react'
import { Button, IconEditOutline16, IconPlusOutline16, IconTrashOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FlowboardSnapshot, LibraryItemType, LibraryItemView } from '@flowboard/contracts'
import { ConfirmDialog, Empty, EntityModal, Field, IconButton, PageHeader, formatDate, type CommandHandler } from './shared.tsx'
import css from '../flowboard.module.css'

type Dialog = { type: 'create' } | { type: 'edit' | 'delete'; item: LibraryItemView } | null

export function LibraryView({ snapshot, projectId, command }: { snapshot: FlowboardSnapshot; projectId: string | null; command: CommandHandler }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const linked = new Set(snapshot.links.projectLibrary.filter(link => projectId === null || link.projectId === projectId).map(link => link.libraryItemId))
  const items = snapshot.library.filter(item => projectId === null || linked.has(item.id))
  const defaultProject = projectId ?? snapshot.projects[0]?.id ?? null
  const editor = dialog?.type === 'edit' ? dialog.item : undefined
  return <section><PageHeader title={projectId === null ? '资料' : '项目资料'} meta={`${items.length} 项资料`} actions={<Button variant="primary" size="sm" icon={<IconPlusOutline16 />} disabled={defaultProject === null} onClick={() => setDialog({ type: 'create' })}>新建资料</Button>} />
    <div>{items.map(item => <article className={css.libraryRow} key={item.id}><span className={css.typeIcon}>{item.type === 'doc' ? '文' : '链'}</span><div className={css.rowMain}><strong>{item.title}</strong><span>{item.content || item.url || '暂无内容'}</span></div><span className={css.typeLabel}>{item.type === 'doc' ? '文档' : '链接'}</span><span>{formatDate(item.updatedAt, false)}</span><div className={css.rowActions}><IconButton label="编辑资料" onClick={() => setDialog({ type: 'edit', item })}><IconEditOutline16 /></IconButton><IconButton label="删除资料" onClick={() => setDialog({ type: 'delete', item })}><IconTrashOutline16 /></IconButton></div></article>)}</div>
    {items.length === 0 && <Empty title="还没有资料" detail="会议整理形成的文档也会出现在这里。" />}
    {(dialog?.type === 'create' || dialog?.type === 'edit') && <EntityModal open title={editor === undefined ? '新建资料' : '编辑资料'} submitLabel="保存" onClose={() => setDialog(null)} onSubmit={async data => { const type = String(data.get('type')) as LibraryItemType; if (editor === undefined) { const selectedProjectId = String(data.get('projectId') || defaultProject); const project = snapshot.projects.find(item => item.id === selectedProjectId); if (project === undefined) throw new Error('请选择项目'); await command({ type: 'library.create', payload: { teamId: project.teamId, projectIds: [selectedProjectId], type, title: String(data.get('title')), ...(type === 'doc' ? { content: String(data.get('content') ?? '') } : { url: String(data.get('url') ?? '') }) } }) } else await command({ type: 'library.update', expectedVersion: editor.version, payload: { id: editor.id, title: String(data.get('title')), content: String(data.get('content') ?? ''), url: String(data.get('url') || '') || null } }) }}><div className={css.formGrid}>{editor === undefined && projectId === null && <Field label="关联项目"><select name="projectId" required defaultValue={defaultProject ?? ''}>{snapshot.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>}<Field label="类型"><select name="type" defaultValue={editor?.type ?? 'doc'} disabled={editor !== undefined}><option value="doc">文档</option><option value="link">链接</option></select></Field><Field label="标题"><Input name="title" required autoFocus defaultValue={editor?.title} /></Field><Field label="链接"><Input name="url" defaultValue={editor?.url ?? ''} /></Field></div><Field label="正文"><textarea name="content" rows={10} defaultValue={editor?.content} /></Field></EntityModal>}
    {dialog?.type === 'delete' && <ConfirmDialog open title="删除资料" detail={`确定删除“${dialog.item.title}”吗？`} onClose={() => setDialog(null)} onConfirm={async () => command({ type: 'library.delete', expectedVersion: dialog.item.version, payload: { id: dialog.item.id } })} />}
  </section>
}
