// src/components/AiAssistant.tsx
import { useEffect, useRef, useState } from "react";
import { chatOnce, openAIStream, type ChatMsg } from "../lib/ai";

export default function AiAssistant() {
    const [open, setOpen] = useState(false);
    const [msgs, setMsgs] = useState<ChatMsg[]>([
        { role: "assistant", content: "嗨～我是站内 AI 助手，直接问我吧!" },
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);

    // 位置（以 right/bottom 记，从右下角向内偏移）
    const [pos, setPos] = useState<{ x: number; y: number }>({ x: 24, y: 24 });

    // 拖拽句柄
    const panelHeaderRef = useRef<HTMLDivElement | null>(null);
    const fabRef = useRef<HTMLDivElement | null>(null);

    // 绑定拖拽（注意：使用 right/bottom，方向要取反）
    useEffect(() => {
        function bindDrag(handle: HTMLElement | null) {
            if (!handle) return;
            let startX = 0, startY = 0, ox = 0, oy = 0;

            const down = (e: PointerEvent) => {
                e.preventDefault();
                startX = e.clientX;
                startY = e.clientY;
                ox = pos.x;
                oy = pos.y;
                handle.setPointerCapture?.(e.pointerId);
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
            };

            const move = (e: PointerEvent) => {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                // 用 right/bottom 定位时，向右/下拖拽应减小 right/bottom
                setPos({
                    x: Math.max(0, ox - dx),
                    y: Math.max(0, oy - dy),
                });
            };

            const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
            };

            handle.addEventListener("pointerdown", down);
            return () => handle.removeEventListener("pointerdown", down);
        }

        const clean1 = bindDrag(panelHeaderRef.current);
        const clean2 = bindDrag(fabRef.current);
        return () => {
            clean1 && clean1();
            clean2 && clean2();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pos.x, pos.y]);

    // WebSocket 引用，组件卸载时关闭
    const wsRef = useRef<WebSocket | null>(null);
    useEffect(() => {
        return () => {
            try { wsRef.current?.close(); } catch { }
        };
    }, []);

    // 发送（默认用流式）
    const send = () => {
        const question = input.trim();
        if (!question || loading) return;

        const base: ChatMsg[] = [...msgs, { role: "user", content: question }];
        const next: ChatMsg[] = [...base, { role: "assistant", content: "" }]; // 先占位
        setMsgs(next);
        setInput("");
        setLoading(true);

        // 兼容“增量 token”和“累计全文”，避免重复
        const onDelta = (delta: string) => {
            setMsgs((old) => {
                const arr = [...old];
                const last = arr[arr.length - 1];
                if (!last || last.role !== "assistant") return arr;

                const prev = last.content || "";
                const d = delta || "";
                if (!d) return arr;

                if (d.startsWith(prev)) {        // 累计全文
                    last.content = d;
                    return arr;
                }
                if (prev.endsWith(d)) {          // 防止重复追加
                    return arr;
                }
                last.content = prev + d;         // 增量 token
                return arr;
            });
        };

        const onDone = () => setLoading(false);

        // 发送时不包含最后一个空的 assistant
        const sendMsgs = next.slice(0, -1);

        const ws = openAIStream(sendMsgs, onDelta, onDone, 0.7);
        wsRef.current = ws;
    };

    return (
        <>
            {/* 面板 */}
            {open && (
                <div
                    style={{
                        position: "fixed",
                        right: pos.x,
                        bottom: pos.y,
                        width: 420,
                        maxWidth: "90vw",
                        height: 480,
                        maxHeight: "70vh",
                        background: "#fff",
                        borderRadius: 16,
                        boxShadow: "0 10px 30px rgba(0,0,0,.15)",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                        zIndex: 9999,
                    }}
                >
                    {/* 头部（可拖拽） */}
                    <div
                        ref={panelHeaderRef}
                        style={{
                            cursor: "grab",
                            userSelect: "none",
                            padding: "12px 16px",
                            borderBottom: "1px solid #f0f0f0",
                            background: "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            fontWeight: 600,
                        }}
                    >
                        AI 助手
                        <button
                            onClick={() => setOpen(false)}
                            style={{
                                border: "none",
                                background: "transparent",
                                fontSize: 20,
                                lineHeight: 1,
                                cursor: "pointer",
                            }}
                            aria-label="关闭"
                            title="关闭"
                        >
                            ×
                        </button>
                    </div>

                    {/* 消息区 */}
                    <div
                        style={{
                            flex: 1,
                            padding: 16,
                            overflow: "auto",
                            background: "#fafafa",
                        }}
                    >
                        {msgs.map((m, i) => (
                            <div
                                key={i}
                                style={{
                                    marginBottom: 12,
                                    display: "flex",
                                    justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                                }}
                            >
                                <div
                                    style={{
                                        maxWidth: "80%",
                                        padding: "10px 12px",
                                        borderRadius: 12,
                                        background: m.role === "user" ? "#2F6BFF" : "#fff",
                                        color: m.role === "user" ? "#fff" : "#000",
                                        boxShadow:
                                            m.role === "user" ? "none" : "0 1px 3px rgba(0,0,0,.06)",
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                    }}
                                >
                                    {m.content}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* 输入区 */}
                    <div
                        style={{
                            padding: 12,
                            display: "flex",
                            gap: 8,
                            borderTop: "1px solid #f0f0f0",
                            background: "#fff",
                        }}
                    >
                        <input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") send();
                            }}
                            placeholder="问点什么…"
                            style={{
                                flex: 1,
                                height: 40,
                                borderRadius: 10,
                                border: "1px solid #e5e5e5",
                                padding: "0 12px",
                                outline: "none",
                            }}
                        />
                        <button
                            onClick={send}
                            disabled={loading}
                            style={{
                                height: 40,
                                padding: "0 16px",
                                borderRadius: 10,
                                border: "none",
                                background: loading ? "#b3c7ff" : "#2F6BFF",
                                color: "#fff",
                                cursor: loading ? "not-allowed" : "pointer",
                            }}
                        >
                            发送
                        </button>
                    </div>
                </div>
            )}

            {/* 右下角悬浮按钮（可拖拽）—— 面板打开时隐藏，避免与发送键重叠 */}
            {!open && (
                <div
                    ref={fabRef}
                    onClick={() => setOpen(true)}
                    style={{
                        position: "fixed",
                        right: pos.x,
                        bottom: pos.y,
                        width: 64,
                        height: 64,
                        borderRadius: "50%",
                        background: "linear-gradient(135deg,#4c8dff,#2f6bff)",
                        color: "#fff",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 24,
                        cursor: "pointer",
                        zIndex: 9999,
                        boxShadow: "0 10px 30px rgba(47,107,255,.35)",
                        userSelect: "none",
                    }}
                    title="打开 AI 助手"
                >
                    💬
                </div>
            )}
        </>
    );
}
