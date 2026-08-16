import { useEffect, useRef, useState } from 'react'
import { Button, IconEditOutline16, IconPlusOutline16, IconTrashOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FlowboardSnapshot, LibraryItemType, LibraryItemView } from '@flowboard/contracts'
import { MarkdownEditor } from './markdown.tsx'
import { ConfirmDialog, Empty, EntityModal, Field, IconButton, PageHeader, formatDate, type CommandHandler } from './shared.tsx'
import css from '../flowboard.module.css'

type Dialog = { type: 'create' } | { type: 'edit' | 'delete' | 'markdown'; item: LibraryItemView } | null

export function LibraryView({ snapshot, projectId, command, openItemId = null }: { snapshot: FlowboardSnapshot; projectId: string | null; command: CommandHandler; openItemId?: string | null }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const openedItemId = useRef<string | null>(null)
  useEffect(() => {
    if (openItemId === null || openedItemId.current === openItemId) return
    const item = snapshot.library.find(value => value.id === openItemId && value.type === 'doc')
    if (item !== undefined) { openedItemId.current = openItemId; setDialog({ type: 'markdown', item }) }
  }, [openItemId, snapshot.library])
  const linked = new Set(snapshot.links.projectLibrary.filter(link => projectId === null || link.projectId === projectId).map(link => link.libraryItemId))
  const items = snapshot.library.filter(item => projectId === null || linked.has(item.id))
  const defaultProject = projectId ?? snapshot.projects[0]?.id ?? null
  const editor = dialog?.type === 'edit' ? dialog.item : undefined
  return <section><PageHeader title={projectId === null ? '资料' : '项目资料'} meta={`${items.length} 项资料`} actions={<Button variant="primary" size="sm" icon={<IconPlusOutline16 />} disabled={defaultProject === null} onClick={() => setDialog({ type: 'create' })}>新建资料</Button>} />
    <div>{items.map(item => <article className={css.libraryRow} key={item.id}><span className={css.typeIcon}>{item.type === 'doc' ? 'MD' : '链'}</span>{item.type === 'doc' ? <button type="button" className={css.rowMain} onClick={() => setDialog({ type: 'markdown', item })}><strong>{item.title}</strong><span>{item.content || '空白 Markdown 文档'}</span></button> : <a className={css.rowMain} href={item.url ?? '#'} target="_blank" rel="noreferrer"><strong>{item.title}</strong><span>{item.url || '未设置链接'}</span></a>}<span className={css.typeLabel}>{item.type === 'doc' ? 'Markdown' : '链接'}</span><span>{formatDate(item.updatedAt, false)}</span><div className={css.rowActions}><IconButton label="编辑资料属性" onClick={() => setDialog({ type: 'edit', item })}><IconEditOutline16 /></IconButton><IconButton label="删除资料" onClick={() => setDialog({ type: 'delete', item })}><IconTrashOutline16 /></IconButton></div></article>)}</div>
    {items.length === 0 && <Empty title="还没有资料" detail="会议整理形成的文档也会出现在这里。" />}
    {(dialog?.type === 'create' || dialog?.type === 'edit') && <EntityModal open title={editor === undefined ? '新建资料' : '编辑资料'} submitLabel="保存" onClose={() => setDialog(null)} onSubmit={async data => { const type = String(data.get('type')) as LibraryItemType; const existingProjects = editor === undefined ? [] : snapshot.links.projectLibrary.filter(link => link.libraryItemId === editor.id).map(link => link.projectId); const projectIds = projectId === null ? data.getAll('projectIds').map(String) : editor === undefined ? [projectId] : existingProjects; if (projectIds.length === 0) throw new Error('至少关联一个项目'); const project = snapshot.projects.find(item => item.id === projectIds[0]); if (project === undefined) throw new Error('请选择项目'); if (editor === undefined) await command({ type: 'library.create', payload: { teamId: project.teamId, projectIds, type, title: String(data.get('title')), ...(type === 'doc' ? { content: String(data.get('content') ?? '') } : { url: String(data.get('url') ?? '') }) } }); else await command({ type: 'library.update', expectedVersion: editor.version, payload: { id: editor.id, projectIds, title: String(data.get('title')), content: String(data.get('content') ?? ''), url: String(data.get('url') || '') || null } }) }}><div className={css.formGrid}>{projectId === null && <Field label="关联项目"><select name="projectIds" multiple required defaultValue={editor === undefined ? defaultProject === null ? [] : [defaultProject] : snapshot.links.projectLibrary.filter(link => link.libraryItemId === editor.id).map(link => link.projectId)}>{snapshot.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>}<Field label="类型"><select name="type" defaultValue={editor?.type ?? 'doc'} disabled={editor !== undefined}><option value="doc">Markdown 文档</option><option value="link">链接</option></select></Field><Field label="标题"><Input name="title" required autoFocus defaultValue={editor?.title} /></Field><Field label="链接"><Input name="url" defaultValue={editor?.url ?? ''} /></Field></div><Field label="Markdown 正文"><textarea name="content" rows={10} defaultValue={editor?.content} /></Field></EntityModal>}
    {dialog?.type === 'markdown' && <MarkdownEditor open title={dialog.item.title} fileName={`${dialog.item.title.replace(/\s+/g, '-').toLowerCase()}.md`} value={dialog.item.content} onClose={() => setDialog(null)} onSave={content => command({ type: 'library.update', expectedVersion: dialog.item.version, payload: { id: dialog.item.id, content } })} />}
    {dialog?.type === 'delete' && <ConfirmDialog open title="删除资料" detail={`确定删除“${dialog.item.title}”吗？`} onClose={() => setDialog(null)} onConfirm={async () => command({ type: 'library.delete', expectedVersion: dialog.item.version, payload: { id: dialog.item.id } })} />}
  </section>
}
