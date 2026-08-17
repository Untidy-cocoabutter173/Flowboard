import { useEffect, useState } from "react";
import {
  ArrowLeftOutlined,
  CheckOutlined,
  EditOutlined,
  EyeOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { Button as AntButton, Segmented } from "antd";
import { Button, TextArea } from "../ui.tsx";
import { EntityModal } from "./shared.tsx";
import css from "../flowboard.module.css";

export function MarkdownPreview({ value }: { value: string }) {
  let inCode = false;
  return (
    <div className={css.markdownPreview}>
      {value.split("\n").map((line, index) => {
        if (line.startsWith("```")) {
          inCode = !inCode;
          return <span key={index} />;
        }
        if (inCode) return <code key={index}>{line || " "}</code>;
        if (line.startsWith("### "))
          return <h3 key={index}>{line.slice(4)}</h3>;
        if (line.startsWith("## ")) return <h2 key={index}>{line.slice(3)}</h2>;
        if (line.startsWith("# ")) return <h1 key={index}>{line.slice(2)}</h1>;
        if (/^[-*] /.test(line))
          return (
            <div className={css.markdownListItem} key={index}>
              {line.slice(2)}
            </div>
          );
        if (/^\d+\. /.test(line))
          return (
            <div className={css.markdownOrderedItem} key={index}>
              {line}
            </div>
          );
        if (line.startsWith("> "))
          return <blockquote key={index}>{line.slice(2)}</blockquote>;
        if (line.trim() === "")
          return <span className={css.markdownBreak} key={index} />;
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

export function MarkdownDocument({
  title,
  fileName,
  value,
  meta,
  onBack,
  onEditProperties,
  onSave,
}: {
  title: string;
  fileName: string;
  value: string;
  meta: string;
  onBack(): void;
  onEditProperties(): void;
  onSave(value: string): Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value);
  const [mode, setMode] = useState<"edit" | "split" | "preview">("split");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    setDraft(value);
    setSaved(true);
  }, [value]);
  const save = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      await onSave(draft);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className={css.markdownDocument}>
      <header className={css.markdownDocumentHeader}>
        <AntButton
          type="text"
          icon={<ArrowLeftOutlined />}
          aria-label="返回资料列表"
          onClick={onBack}
        />
        <div>
          <span>{meta}</span>
          <h2>{title}</h2>
          <code>{fileName}</code>
        </div>
        <div className={css.markdownDocumentActions}>
          <AntButton icon={<EditOutlined />} onClick={onEditProperties}>
            属性
          </AntButton>
          <AntButton
            type="primary"
            icon={saved ? <CheckOutlined /> : <SaveOutlined />}
            loading={saving}
            disabled={saved}
            onClick={() => void save().catch(() => undefined)}
          >
            {saved ? "已保存" : "保存"}
          </AntButton>
        </div>
      </header>
      <div className={css.markdownDocumentToolbar}>
        <Segmented
          value={mode}
          onChange={(next) => setMode(next as typeof mode)}
          options={[
            { value: "edit", label: "编辑", icon: <EditOutlined /> },
            { value: "split", label: "双栏" },
            { value: "preview", label: "预览", icon: <EyeOutlined /> },
          ]}
        />
        <span>{draft.length.toLocaleString()} 字符</span>
      </div>
      <div className={css.markdownDocumentBody} data-mode={mode}>
        <textarea
          aria-label={`${title} Markdown 正文`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaved(event.target.value === value);
          }}
          spellCheck={false}
        />
        <MarkdownPreview value={draft} />
      </div>
    </section>
  );
}

export function MarkdownEditor({
  open,
  title,
  fileName,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  fileName: string;
  value: string;
  onClose(): void;
  onSave(value: string): Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value);
  const [mode, setMode] = useState<"edit" | "split" | "preview">("split");
  useEffect(() => {
    if (open) {
      setDraft(value);
      setMode("split");
    }
  }, [open, value]);
  return (
    <EntityModal
      open={open}
      title={title}
      submitLabel="保存 Markdown"
      onClose={onClose}
      onSubmit={() => onSave(draft)}
    >
      <div className={css.markdownToolbar}>
        <code>{fileName}</code>
        <div>
          <Button
            type="button"
            size="sm"
            variant={mode === "edit" ? "primary" : "ghost"}
            onClick={() => setMode("edit")}
          >
            编辑
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "split" ? "primary" : "ghost"}
            onClick={() => setMode("split")}
          >
            双栏
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "preview" ? "primary" : "ghost"}
            onClick={() => setMode("preview")}
          >
            预览
          </Button>
        </div>
      </div>
      <div className={css.markdownWorkspace} data-mode={mode}>
        <TextArea
          aria-label={`${title} Markdown 正文`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
        />
        <MarkdownPreview value={draft} />
      </div>
    </EntityModal>
  );
}
