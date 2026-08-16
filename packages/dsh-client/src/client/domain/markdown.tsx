import { useEffect, useState } from "react";
import { Button, TextArea } from "../ui.tsx";
import { EntityModal } from "./shared.tsx";
import css from "../flowboard.module.css";

function MarkdownPreview({ value }: { value: string }) {
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
