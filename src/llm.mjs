// OpenAI 兼容的 chat/completions 客户端 —— 只用内置 fetch，无第三方依赖。

export async function chatJSON(llm, { system, user, temperature = 0.3, _retry = true }) {
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
  try {
    return parseJSON(content);
  } catch (e) {
    // 本地小模型(qwen 等)偶尔吐非法 JSON。别让整趟解析(等了 1~3 分钟)前功尽弃，
    // 追加"只输出 JSON"的强约束、降温再试一次。
    if (!_retry) throw e;
    return chatJSON(llm, {
      system: system + "\n\n【重要】上一次输出不是合法 JSON。这次只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。",
      user,
      temperature: Math.min(temperature, 0.1),
      _retry: false,
    });
  }
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
