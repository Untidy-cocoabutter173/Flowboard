import { useState } from 'react'
import { Button, IconEditOutline16, IconLinkOutline16, IconPlusOutline16, IconTrashOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FlowboardSnapshot, LibraryItemType, LibraryItemView } from '@flowboard/contracts'
import { ConfirmDialog, Empty, EntityModal, Field, IconButton, PageHeader, type CommandHandler } from './shared.tsx'
import css from '../flowboard.module.css'

type Dialog = { type: 'create' } | { type: 'edit' | 'delete'; item: LibraryItemView } | null

export function LibraryView({ snapshot, projectId, command }: { snapshot: FlowboardSnapshot; projectId: string | null; command: CommandHandler }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  if (projectId === null) return <Empty title="请先创建项目" detail="资料需要归属到一个项目。" />
  const items = snapshot.library.filter(item => item.projectId === projectId)
  const editor = dialog?.type === 'edit' ? dialog.item : undefined
  const submit = async (data: FormData) => {
    const type = String(data.get('type')) as LibraryItemType
    const body = String(data.get('body') ?? '')
    if (editor === undefined) await command({ type: 'library.create', payload: { projectId, type, title: String(data.get('title')), ...(type === 'link' ? { url: body } : { content: body }) } })
    else await command({ type: 'library.update', expectedVersion: editor.version, payload: { id: editor.id, title: String(data.get('title')), ...(editor.type === 'link' ? { url: body } : { content: body }) } })
  }
  return <section><PageHeader title="资料" meta={`${items.length} 项资料`} actions={<Button variant="primary" size="sm" icon={<IconPlusOutline16 />} onClick={() => setDialog({ type: 'create' })}>新建资料</Button>} />
    <div className={css.libraryList}>{items.map(item => <article className={css.libraryRow} key={item.id}><div className={css.typeIcon}>{item.type === 'link' ? <IconLinkOutline16 /> : <span>文</span>}</div><div className={css.rowMain}><strong>{item.title}</strong><span>{item.type === 'link' ? item.url : item.content || '空文档'}</span></div><span className={css.typeLabel}>{item.type === 'link' ? '链接' : '文档'}</span><div className={css.rowActions}><IconButton label="编辑资料" onClick={() => setDialog({ type: 'edit', item })}><IconEditOutline16 /></IconButton><IconButton label="删除资料" onClick={() => setDialog({ type: 'delete', item })}><IconTrashOutline16 /></IconButton></div></article>)}</div>
    {items.length === 0 && <Empty title="还没有资料" detail="可保存项目文档或外部链接。" />}
    {(dialog?.type === 'create' || dialog?.type === 'edit') && <EntityModal open title={editor === undefined ? '新建资料' : '编辑资料'} submitLabel={editor === undefined ? '创建' : '保存'} onClose={() => setDialog(null)} onSubmit={submit}><Field label="类型"><select name="type" defaultValue={editor?.type ?? 'doc'} disabled={editor !== undefined}><option value="doc">文档</option><option value="link">链接</option></select></Field><Field label="标题"><Input name="title" required autoFocus maxLength={240} defaultValue={editor?.title} /></Field><Field label={editor?.type === 'link' ? '链接地址' : '正文内容'}><textarea name="body" rows={8} defaultValue={editor?.type === 'link' ? editor.url ?? '' : editor?.content ?? ''} /></Field></EntityModal>}
    {dialog?.type === 'delete' && <ConfirmDialog open title="删除资料" detail={`确定删除“${dialog.item.title}”吗？`} onClose={() => setDialog(null)} onConfirm={async () => command({ type: 'library.delete', expectedVersion: dialog.item.version, payload: { id: dialog.item.id } })} />}
  </section>
}
