import { useCallback, useState } from 'react'
import { Button, IconEditOutline16, IconPlayOutline16, IconPlusOutline16, IconStopFill16, IconTrashOutline16, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FlowboardSnapshot, MeetingView } from '@flowboard/contracts'
import { useAudioRecorder } from '../use-audio-recorder.ts'
import { ConfirmDialog, Empty, EntityModal, Field, IconButton, PageHeader, formatDate, type CommandHandler } from './shared.tsx'
import css from '../flowboard.module.css'

type Dialog = { type: 'create' } | { type: 'edit' | 'transcript' | 'summary' | 'delete'; meeting: MeetingView } | null
const statusText = { idle: '未开始', live: '进行中', ended: '已结束' } as const

function Recorder({ meeting, upload }: { meeting: MeetingView; upload: (id: string, blob: Blob) => Promise<unknown> }) {
  const [uploading, setUploading] = useState(false)
  const onAudio = useCallback(async (blob: Blob) => {
    setUploading(true)
    try { await upload(meeting.id, blob) } finally { setUploading(false) }
  }, [meeting.id, upload])
  const audio = useAudioRecorder(onAudio)
  const disabled = meeting.status !== 'live' || uploading
  return <div className={css.recorder}><Button variant={audio.recording ? 'outline' : 'ghost'} size="sm" className={audio.recording ? css.dangerButton : undefined} icon={audio.recording ? <IconStopFill16 /> : undefined} disabled={disabled} onClick={() => void (audio.recording ? audio.stop() : audio.start())}>{uploading ? '正在转写' : audio.recording ? '停止录音' : '录音转写'}</Button>{audio.error !== null && <span role="alert">{audio.error}</span>}</div>
}

export function MeetingsView({ snapshot, projectId, command, upload }: { snapshot: FlowboardSnapshot; projectId: string | null; command: CommandHandler; upload: (id: string, blob: Blob) => Promise<unknown> }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  if (projectId === null) return <Empty title="请先创建项目" detail="会议记录需要归属到一个项目。" />
  const meetings = snapshot.meetings.filter(item => item.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return <section><PageHeader title="会议" meta={`${meetings.length} 场会议`} actions={<Button variant="primary" size="sm" icon={<IconPlusOutline16 />} onClick={() => setDialog({ type: 'create' })}>新建会议</Button>} />
    <div className={css.meetingList}>{meetings.map(meeting => <article className={css.meeting} key={meeting.id}>
      <header><div className={css.meetingTitle}><StateDot state={meeting.status === 'live' ? 'ongoing' : meeting.status === 'ended' ? 'done' : 'warning'} /><div><strong>{meeting.title}</strong><span>{statusText[meeting.status]} · {formatDate(meeting.startedAt ?? meeting.createdAt)}</span></div></div><div className={css.rowActions}><IconButton label="编辑会议" onClick={() => setDialog({ type: 'edit', meeting })}><IconEditOutline16 /></IconButton><IconButton label="删除会议" onClick={() => setDialog({ type: 'delete', meeting })}><IconTrashOutline16 /></IconButton></div></header>
      <div className={css.meetingActions}>{meeting.status === 'idle' && <Button variant="primary" size="sm" icon={<IconPlayOutline16 />} onClick={() => void command({ type: 'meeting.update', expectedVersion: meeting.version, payload: { id: meeting.id, status: 'live' } }).catch(() => undefined)}>开始会议</Button>}{meeting.status === 'live' && <Button variant="outline" size="sm" className={css.dangerButton} icon={<IconStopFill16 />} onClick={() => void command({ type: 'meeting.update', expectedVersion: meeting.version, payload: { id: meeting.id, status: 'ended' } }).catch(() => undefined)}>结束会议</Button>}<Recorder meeting={meeting} upload={upload} /><Button variant="ghost" size="sm" onClick={() => setDialog({ type: 'transcript', meeting })}>追加记录</Button><Button variant="ghost" size="sm" onClick={() => setDialog({ type: 'summary', meeting })}>编辑总结</Button></div>
      <div className={css.meetingBody}><section><h3>会议记录</h3><p className={meeting.transcript === '' ? css.muted : undefined}>{meeting.transcript || '暂无会议记录'}</p></section><section><h3>会议总结</h3><p className={meeting.summary === '' ? css.muted : undefined}>{meeting.summary || '暂无会议总结'}</p></section></div>
    </article>)}</div>
    {meetings.length === 0 && <Empty title="还没有会议" detail="创建会议后可记录过程并整理总结。" />}
    <EntityModal open={dialog?.type === 'create'} title="新建会议" submitLabel="创建" onClose={() => setDialog(null)} onSubmit={async data => command({ type: 'meeting.create', payload: { projectId, title: String(data.get('title')) } })}><Field label="会议主题"><Input name="title" required autoFocus maxLength={240} /></Field></EntityModal>
    {dialog?.type === 'edit' && <EntityModal open title="编辑会议" submitLabel="保存" onClose={() => setDialog(null)} onSubmit={async data => command({ type: 'meeting.update', expectedVersion: dialog.meeting.version, payload: { id: dialog.meeting.id, title: String(data.get('title')) } })}><Field label="会议主题"><Input name="title" required autoFocus maxLength={240} defaultValue={dialog.meeting.title} /></Field></EntityModal>}
    {dialog?.type === 'transcript' && <EntityModal open title="追加会议记录" submitLabel="追加" onClose={() => setDialog(null)} onSubmit={async data => command({ type: 'meeting.transcript.append', expectedVersion: dialog.meeting.version, payload: { id: dialog.meeting.id, text: String(data.get('text')) } })}><Field label="记录内容"><textarea name="text" rows={8} required autoFocus /></Field></EntityModal>}
    {dialog?.type === 'summary' && <EntityModal open title="编辑会议总结" submitLabel="保存" onClose={() => setDialog(null)} onSubmit={async data => command({ type: 'meeting.summary.set', expectedVersion: dialog.meeting.version, payload: { id: dialog.meeting.id, content: String(data.get('content')) } })}><Field label="总结内容"><textarea name="content" rows={10} autoFocus defaultValue={dialog.meeting.summary} /></Field></EntityModal>}
    {dialog?.type === 'delete' && <ConfirmDialog open title="删除会议" detail={`确定删除“${dialog.meeting.title}”及其全部记录吗？`} onClose={() => setDialog(null)} onConfirm={async () => command({ type: 'meeting.delete', expectedVersion: dialog.meeting.version, payload: { id: dialog.meeting.id } })} />}
  </section>
}
