import { useMemo, useRef } from "react";

type TemplateSnippet = {
  id: string;
  label: string;
  text: string;
};

type ComposerProps = {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  disabled?: boolean;
  templates: TemplateSnippet[];
};

export const Composer = ({ value, onChange, onSend, disabled, templates }: ComposerProps) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isSendDisabled = disabled || value.trim().length === 0;

  const templateMap = useMemo(
    () => new Map(templates.map((item) => [item.id, item])),
    [templates]
  );

  const insertTemplate = (templateId: string) => {
    const template = templateMap.get(templateId);
    if (!template) {
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(value + template.text);
      return;
    }
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${template.text}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      const cursor = start + template.text.length;
      textarea.setSelectionRange(cursor, cursor);
      textarea.focus();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => insertTemplate(template.id)}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 12,
              background: "#ffffff",
              cursor: "pointer",
            }}
          >
            {template.label}
          </button>
        ))}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            if (!isSendDisabled) {
              onSend();
            }
          }
        }}
        placeholder="Describe your motion, scene, and music idea..."
        style={{
          width: "100%",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          resize: "vertical",
          fontSize: 14,
          lineHeight: 1.5,
        }}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, color: "#9ca3af" }}>Enter to send - Shift+Enter for new line</div>
        <button
          type="button"
          onClick={onSend}
          disabled={isSendDisabled}
          style={{
            borderRadius: 10,
            padding: "8px 16px",
            border: "none",
            background: isSendDisabled ? "#e5e7eb" : "#111827",
            color: isSendDisabled ? "#9ca3af" : "#f9fafb",
            cursor: isSendDisabled ? "not-allowed" : "pointer",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};
