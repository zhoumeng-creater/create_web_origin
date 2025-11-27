// src/MusicChat.tsx
import { useRef, useState } from "react";
import { Card, Form, Input, Button, List, message, Space, Typography } from "antd";
import { api } from "./lib/api"; // 你项目里已有的 axios 实例

type ChatMsg = { role: "user" | "assistant"; content: string };

export default function MusicChat() {
    const [form] = Form.useForm();
    const [chatLoading, setChatLoading] = useState(false);
    const [genLoading, setGenLoading] = useState(false);
    const [msgs, setMsgs] = useState<ChatMsg[]>([
        {
            role: "assistant",
            content:
                "我是 AnimationGPT 的音乐助手（基于 MusicGPT）。我只回答与本网站相关的内容，并帮你把需求改写成生成音乐的提示词。比如：'来一首 80 年代风格合成器流行，带律动贝斯与大鼓的 100BPM 曲子'。",
        },
    ]);

    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const objectUrlRef = useRef<string | null>(null);

    const append = (m: ChatMsg) => setMsgs((old) => [...old, m]);

    // 1) 向 MusicGPT 询问“提示词”（聊天），你可以把路径换成你 MusicGPT 的实际聊天接口
    const onAsk = async (v: any) => {
        const text = (v?.text || "").trim();
        if (!text) return;
        form.resetFields(["text"]);
        append({ role: "user", content: text });

        setChatLoading(true);
        try {
            // 例：把你希望的“聊天”请求按 MusicGPT 的接口改一下
            // 假设 MusicGPT 有 /api/chat 接口（POST），body: {messages:[{role, content},...]}
            const payload = {
                // 给一个系统身份，限定只回答“网站相关 + 文生音乐提示词”
                system_prompt:
                    "你是 AnimationGPT 助手，只能回答与本站相关问题。对音乐需求，输出简洁明确的 '提示词'（风格/情绪/速度/编制/乐器/结构等）。不要跑题。",
                messages: msgs.concat({ role: "user", content: text }),
            };

            const { data } = await api.post("/music/api/chat", payload, {
                // 通过我们后端代理：/music/... → MusicGPT_BASE/...
                // 如果你的 MusicGPT 并不是这个路径，请把 '/music/api/chat' 改成相应的代理路径
            });

            // 容错：拿 content 字段或 data.reply 等
            const reply =
                data?.reply || data?.content || data?.message || JSON.stringify(data);
            append({ role: "assistant", content: String(reply) });
            message.success("已获取提示词");
        } catch (e: any) {
            message.error(e?.response?.data?.detail || "聊天失败，请检查 MusicGPT 服务与路径");
        } finally {
            setChatLoading(false);
        }
    };

    // 2) 直接“生成音乐”：把最后一条 assistant 的提示词作为输入，也支持手动覆盖
    const onGenerate = async () => {
        // 找最近一条 assistant 的内容，当成提示词
        const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
        if (!lastAssistant) {
            message.info("先和助手聊聊，拿到提示词再点生成～");
            return;
        }

        setGenLoading(true);
        try {
            // 假设 MusicGPT 有 /api/generate 接口（POST），body: { prompt: string }
            const { data } = await api.post("/music/api/generate", {
                prompt: lastAssistant.content,
            });

            // 两种返回都兼容：audio_url 或 audio_base64
            let url: string | null = null;

            if (data?.audio_url) {
                url = data.audio_url as string;
            } else if (data?.audio_base64) {
                // 把 base64 转成 blob
                const b64 = data.audio_base64 as string;
                const byteString = atob(b64);
                const bytes = new Uint8Array(byteString.length);
                for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
                const blob = new Blob([bytes], { type: "audio/wav" }); // 或 audio/mpeg，看你的服务返回
                // 释放旧 URL
                if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
                url = URL.createObjectURL(blob);
                objectUrlRef.current = url;
            } else {
                message.error("未找到音频数据字段（audio_url 或 audio_base64）");
                setGenLoading(false);
                return;
            }

            setAudioUrl(url);
            message.success("音乐已生成");
        } catch (e: any) {
            message.error(e?.response?.data?.detail || "生成失败，请检查 MusicGPT 接口路径/返回格式");
        } finally {
            setGenLoading(false);
        }
    };

    return (
        <Card title="文本 → 音乐（MusicGPT）" style={{ maxWidth: 960 }}>
            <Space direction="vertical" size="large" style={{ width: "100%" }}>
                <List
                    bordered
                    dataSource={msgs}
                    renderItem={(m) => (
                        <List.Item
                            style={{
                                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                                background: m.role === "user" ? "#f0f6ff" : "#fff",
                            }}
                        >
                            <div style={{ maxWidth: 720 }}>
                                <Typography.Text strong>
                                    {m.role === "user" ? "我" : "助手"}：
                                </Typography.Text>
                                <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{m.content}</div>
                            </div>
                        </List.Item>
                    )}
                />

                <Form form={form} layout="vertical" onFinish={onAsk}>
                    <Form.Item
                        name="text"
                        label="对音乐的想法（会先转换为“提示词”）"
                        rules={[{ required: true, message: "先简单描述你想要的音乐" }]}
                    >
                        <Input.TextArea rows={3} placeholder="例如：来一首 80 年代合成器流行，100 BPM，情绪热烈，突出低音鼓与合成器…" />
                    </Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" loading={chatLoading}>
                            生成提示词
                        </Button>
                        <Button onClick={onGenerate} loading={genLoading}>
                            一键生成音乐
                        </Button>
                    </Space>
                </Form>

                {audioUrl && (
                    <Card size="small" title="预览 / 下载">
                        <audio src={audioUrl} controls style={{ width: "100%" }} />
                        <div style={{ marginTop: 8 }}>
                            <a href={audioUrl} download>
                                下载音频
                            </a>
                        </div>
                    </Card>
                )}
            </Space>
        </Card>
    );
}
