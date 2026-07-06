const OUTPUT_LANG_INSTRUCTIONS = {
  en: "Output language: English. Keep JSON keys exactly as specified by the schema; translate only human-readable values.",
};

export function normalizeOutputLang(value) {
  const lang = String(value || "zh").trim().toLowerCase();
  if (lang === "zh" || lang === "en") return lang;
  throw new Error("PAODING_OUTPUT_LANG 只支持 zh 或 en");
}

export function outputLanguageInstruction(lang) {
  return OUTPUT_LANG_INSTRUCTIONS[normalizeOutputLang(lang)] || "";
}

export function withOutputLanguage(system, lang) {
  const instruction = outputLanguageInstruction(lang);
  return instruction ? `${system}\n\n${instruction}` : system;
}
