export function techniqueCacheFileName(name) {
  const value = String(name || "").trim();
  if (!value) throw Object.assign(new Error("技法名称为空"), { statusCode: 400 });
  return `${Buffer.from(value, "utf8").toString("base64url")}.json`;
}

export function techniqueOccurrenceSignature(occurrences = []) {
  const keys = new Set();
  for (const o of occurrences || []) {
    const rid = String(o?.recipeId || "").trim();
    const step = Number(o?.stepIndex) || 0;
    if (rid && step) keys.add(`${rid}#${step}`);
  }
  return [...keys].sort().join("|");
}

export function isTechniqueSummaryCacheFresh(cache, signature) {
  return Boolean(
    cache &&
    cache.signature === signature &&
    cache.summary &&
    typeof cache.summary === "object"
  );
}

export function normalizeTechniqueSummary(raw) {
  const src = raw?.summary && typeof raw.summary === "object" ? raw.summary : (raw || {});
  const text = (...keys) => {
    for (const k of keys) {
      const v = src[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "暂无足够样本归纳。";
  };
  return {
    when: text("when", "什么时候用", "use_when", "usage"),
    keys: text("keys", "关键判断", "key_points", "cues"),
    pitfalls: text("pitfalls", "常见翻车点", "common_mistakes", "mistakes"),
  };
}
