import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientCommand } from '../controller.ts'
import css from '../flowboard.module.css'

export type CommandHandler = (value: ClientCommand) => Promise<void>

export function PageHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return <header className={css.sectionHeader}><div><h2>{title}</h2>{meta !== undefined && <p>{meta}</p>}</div><div className={css.headerActions}>{actions}</div></header>
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return <div className={css.empty}><strong>{title}</strong>{detail !== undefined && <span>{detail}</span>}</div>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className={css.field}><span>{label}</span>{children}{hint !== undefined && <small>{hint}</small>}</label>
}

export function IconButton({ label, children, onClick, disabled = false }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <Tooltip label={label}><Button variant="toolbar" size="sm" aria-label={label} onClick={onClick} disabled={disabled}>{children}</Button></Tooltip>
}

export function EntityModal({ open, title, submitLabel, onClose, onSubmit, children, danger = false }: {
  open: boolean
  title: string
  submitLabel: string
  onClose: () => void
  onSubmit: (data: FormData) => Promise<void>
  children: ReactNode
  danger?: boolean
}) {
  const formId = useId()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  useEffect(() => { if (!open) setSubmitError(null) }, [open])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onSubmit(new FormData(event.currentTarget))
      onClose()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }
  return <Modal open={open} onClose={onClose} title={title} closeLabel="关闭" footer={<><Button variant="ghost" onClick={onClose} disabled={submitting}>取消</Button><Button className={danger ? css.dangerButton : undefined} variant={danger ? 'outline' : 'primary'} type="submit" form={formId} disabled={submitting}>{submitting ? '正在保存' : submitLabel}</Button></>}>
    <form id={formId} className={css.modalForm} onSubmit={event => void submit(event)}>{children}{submitError !== null && <p className={css.formError} role="alert">{submitError}</p>}</form>
  </Modal>
}

export function ConfirmDialog({ open, title, detail, confirmLabel = '删除', onClose, onConfirm }: {
  open: boolean
  title: string
  detail: string
  confirmLabel?: string
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  return <EntityModal open={open} title={title} submitLabel={confirmLabel} onClose={onClose} danger onSubmit={onConfirm}>
    <p className={css.confirmText}>{detail}</p>
  </EntityModal>
}

export function formatDate(value: string | null, includeTime = true): string {
  if (value === null || value === '') return '未设置'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', includeTime
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

export function toIso(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? '').trim()
  return text === '' ? undefined : new Date(text).toISOString()
}

export function localDateTime(value: string | null): string {
  if (value === null || value === '') return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
