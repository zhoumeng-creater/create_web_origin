import { useEffect, useRef } from "react";

import { ChatMessage, MessageBubble } from "./MessageBubble";

type ChatListProps = {
  messages: ChatMessage[];
};

export const ChatList = ({ messages }: ChatListProps) => {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 280,
        maxHeight: "60vh",
        overflowY: "auto",
        padding: 16,
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {messages.length === 0 ? (
        <div style={{ color: "#9ca3af", fontSize: 14 }}>
          Start a conversation to generate your first work.
        </div>
      ) : (
        messages.map((message) => <MessageBubble key={message.id} message={message} />)
      )}
      <div ref={endRef} />
    </div>
  );
};
