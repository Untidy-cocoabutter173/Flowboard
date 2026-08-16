import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button, DatePicker, Modal, Select, Tooltip } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type { ClientCommand } from "../controller.ts";
import css from "../flowboard.module.css";

export type CommandHandler = (value: ClientCommand) => Promise<unknown>;

export interface SelectOption {
  value: string;
  label: string;
  meta?: string | undefined;
}

export function SelectControl({
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  ariaLabel,
  placeholder = "请选择",
  disabled = false,
  className,
}: {
  options: SelectOption[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  name?: string | undefined;
  ariaLabel: string;
  placeholder?: string | undefined;
  disabled?: boolean;
  className?: string | undefined;
}) {
  const [current, setCurrent] = useState(value ?? defaultValue);
  useEffect(() => {
    if (value !== undefined) setCurrent(value);
  }, [value]);
  return (
    <>
      <Select<string>
        className={`${css.selectControl} ${className ?? ""}`}
        aria-label={ariaLabel}
        options={options.map((option) => ({
          value: option.value,
          label: (
            <span className={css.selectOption}>
              <span>{option.label}</span>
              {option.meta !== undefined && <small>{option.meta}</small>}
            </span>
          ),
        }))}
        value={current ?? null}
        onChange={(next) => {
          setCurrent(next);
          onValueChange?.(next);
        }}
        placeholder={placeholder}
        disabled={disabled}
        popupMatchSelectWidth={false}
      />
      {name !== undefined && (
        <input type="hidden" name={name} value={current ?? ""} />
      )}
    </>
  );
}

export function MultiSelectControl({
  options,
  defaultValue = [],
  name,
  ariaLabel,
  placeholder = "请选择",
  disabled = false,
}: {
  options: SelectOption[];
  defaultValue?: string[] | undefined;
  name: string;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [current, setCurrent] = useState<string[]>(defaultValue);
  return (
    <>
      <Select<string[]>
        mode="multiple"
        className={css.selectControl!}
        aria-label={ariaLabel}
        value={current}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        maxTagCount="responsive"
        onChange={setCurrent}
      />
      {current.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

export function DateTimeControl({
  name,
  defaultValue,
  ariaLabel,
}: {
  name: string;
  defaultValue?: string | null | undefined;
  ariaLabel: string;
}) {
  const [current, setCurrent] = useState<Dayjs | null>(
    defaultValue === undefined || defaultValue === null || defaultValue === ""
      ? null
      : dayjs(defaultValue),
  );
  return (
    <>
      <DatePicker
        className={css.dateControl!}
        aria-label={ariaLabel}
        value={current}
        showTime={{ format: "HH:mm" }}
        format="YYYY-MM-DD HH:mm"
        placeholder="选择日期和时间"
        onChange={setCurrent}
      />
      <input
        type="hidden"
        name={name}
        value={current?.toISOString() ?? ""}
      />
    </>
  );
}

export function DateControl({
  name,
  defaultValue,
  ariaLabel,
}: {
  name: string;
  defaultValue?: string | null | undefined;
  ariaLabel: string;
}) {
  const [current, setCurrent] = useState<Dayjs | null>(
    defaultValue === undefined || defaultValue === null || defaultValue === ""
      ? null
      : dayjs(defaultValue),
  );
  return (
    <>
      <DatePicker
        className={css.dateControl!}
        aria-label={ariaLabel}
        value={current}
        format="YYYY-MM-DD"
        placeholder="选择日期"
        onChange={setCurrent}
      />
      <input
        type="hidden"
        name={name}
        value={current?.format("YYYY-MM-DD") ?? ""}
      />
    </>
  );
}

export function InlineDateControl({
  value,
  ariaLabel,
  onChange,
}: {
  value: string | null;
  ariaLabel: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <DatePicker
      className={css.inlineDateControl!}
      aria-label={ariaLabel}
      value={value === null || value === "" ? null : dayjs(value)}
      format="YYYY-MM-DD"
      placeholder="未设置"
      onChange={(next) => onChange(next?.format("YYYY-MM-DD") ?? null)}
    />
  );
}

export function InlineDateTimeControl({
  value,
  ariaLabel,
  onChange,
}: {
  value: string | null;
  ariaLabel: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <DatePicker
      className={css.inlineDateControl!}
      aria-label={ariaLabel}
      value={value === null || value === "" ? null : dayjs(value)}
      showTime={{ format: "HH:mm" }}
      format="MM-DD HH:mm"
      placeholder="未设置"
      onChange={(next) => onChange(next?.toISOString() ?? null)}
    />
  );
}

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={css.sectionHeader}>
      <div>
        <h2>{title}</h2>
        {meta !== undefined && <p>{meta}</p>}
      </div>
      <div className={css.headerActions}>{actions}</div>
    </header>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className={css.empty}>
      <strong>{title}</strong>
      {detail !== undefined && <span>{detail}</span>}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className={css.field}>
      <span>{label}</span>
      {children}
      {hint !== undefined && <small>{hint}</small>}
    </label>
  );
}

export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip title={label}>
      <Button
        type="text"
        size="small"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        icon={children}
      />
    </Tooltip>
  );
}

export function EntityModal({
  open,
  title,
  submitLabel,
  onClose,
  onSubmit,
  children,
  danger = false,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (data: FormData) => Promise<unknown>;
  children: ReactNode;
  danger?: boolean;
}) {
  const formId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setSubmitError(null);
  }, [open]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(new FormData(event.currentTarget));
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={title}
      destroyOnHidden
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            danger={danger}
            type={danger ? "default" : "primary"}
            htmlType="submit"
            form={formId}
            loading={submitting}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={css.modalForm}
        onSubmit={(event) => void submit(event)}
      >
        {children}
        {submitError !== null && (
          <p className={css.formError} role="alert">
            {submitError}
          </p>
        )}
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  open,
  title,
  detail,
  confirmLabel = "删除",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  detail: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => Promise<unknown>;
}) {
  return (
    <EntityModal
      open={open}
      title={title}
      submitLabel={confirmLabel}
      onClose={onClose}
      danger
      onSubmit={onConfirm}
    >
      <p className={css.confirmText}>{detail}</p>
    </EntityModal>
  );
}

export function formatDate(value: string | null, includeTime = true): string {
  if (value === null || value === "") return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(
    "zh-CN",
    includeTime
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "short", day: "numeric" },
  ).format(date);
}

export function toIso(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text === "" ? undefined : new Date(text).toISOString();
}

export function localDateTime(value: string | null): string {
  if (value === null || value === "") return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
