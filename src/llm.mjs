// OpenAI 兼容的 chat/completions 客户端 —— 只用内置 fetch，无第三方依赖。

export async function chatJSON(llm, { system, user, temperature = 0.3 }) {
  const body = {
    model: llm.model,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  const res = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llm.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM 请求失败 ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  return parseJSON(content);
}

// 自由文本对话（追问、食材替代等），不强制 JSON。
export async function chatText(llm, { system, user, temperature = 0.5 }) {
  const res = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({
      model: llm.model,
      temperature,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM 请求失败 ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

// 视觉对话：把若干截图（base64 jpg）连同提示喂给视觉模型，读屏上文字与画面观察。
export async function chatVision(vision, { system, user, images = [], temperature = 0.2 }) {
  const content = [
    { type: "text", text: user },
    ...images.map((b64) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } })),
  ];
  const res = await fetch(`${vision.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${vision.apiKey}` },
    body: JSON.stringify({
      model: vision.model,
      temperature,
      messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content }],
    }),
  });
  if (!res.ok) {
    const d = await res.text().catch(() => "");
    throw new Error(`视觉模型请求失败 ${res.status}: ${d.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

// 有些模型即使开了 json_object 也会包 ```json 代码块，做个兜底。
function parseJSON(text) {
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1].trim());
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`模型未返回合法 JSON：${trimmed.slice(0, 300)}`);
  }
}
