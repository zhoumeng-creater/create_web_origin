export type MessageRole = "user" | "system" | "tool" | "result";

export type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  jobId?: string;
  progress?: number;
  stage?: string;
  timestamp?: string;
};

type MessageBubbleProps = {
  message: ChatMessage;
};

const getBubbleStyle = (role: MessageRole) => {
  switch (role) {
    case "user":
      return {
        alignSelf: "flex-end",
        background: "#111827",
        color: "#f9fafb",
      };
    case "result":
      return {
        alignSelf: "flex-start",
        background: "#ecfccb",
        color: "#365314",
        border: "1px solid #bef264",
      };
    case "tool":
      return {
        alignSelf: "flex-start",
        background: "#eff6ff",
        color: "#1e3a8a",
        border: "1px solid #bfdbfe",
      };
    case "system":
    default:
      return {
        alignSelf: "flex-start",
        background: "#f3f4f6",
        color: "#111827",
      };
  }
};

export const MessageBubble = ({ message }: MessageBubbleProps) => {
  const bubbleStyle = getBubbleStyle(message.role);
  const progress = typeof message.progress === "number" ? message.progress : null;
  const stage = message.stage;

  return (
    <div
      style={{
        alignSelf: bubbleStyle.alignSelf,
        maxWidth: "78%",
        padding: "12px 14px",
        borderRadius: 14,
        background: bubbleStyle.background,
        color: bubbleStyle.color,
        border: bubbleStyle.border,
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {stage ? (
        <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>{stage}</div>
      ) : null}
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{message.content}</div>
      {progress !== null ? (
        <div
          style={{
            height: 6,
            borderRadius: 999,
            background: "rgba(15, 23, 42, 0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(100, progress))}%`,
              height: "100%",
              background: bubbleStyle.color,
              opacity: 0.45,
              transition: "width 200ms ease",
            }}
          />
        </div>
      ) : null}
    </div>
  );
};
