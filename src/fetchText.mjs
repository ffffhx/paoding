import { spawn } from "node:child_process";
import { assertPublicUrl } from "./urlSafety.mjs";
import { fetchWithRetry } from "./fetchRetry.mjs";

// 跑子进程并捕获 stdout（用于 yt-dlp -j 抓元数据）。
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err.slice(-300) || `退出码 ${code}`))));
  });
}

// 从 HTML 里挖可读文字：优先 og:title / og:description（帖子摘要/正文常在这），再兜底扒正文文本。
export function extractFromHtml(html) {
  const pick = (re) => { const m = html.match(re); return m ? m[1].trim() : ""; };
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const title = ogTitle || pick(/<title[^>]*>([^<]*)<\/title>/i);
  const ogDesc = pick(/<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  // 正文兜底：去掉 script/style/标签，压缩空白
  const body = (html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
  // og:description 通常最干净；正文更全但杂。谁长用谁，二者都留。
  const text = [ogDesc, body.length > ogDesc.length * 2 ? body.slice(0, 6000) : ""].filter(Boolean).join("\n");
  return { title, text: text.trim() };
}

const MISSING_OR_BLOCKED_RE = /(你访问的页面不见了|页面不存在|内容不存在|笔记不存在|请先登录|登录后|访问受限|安全验证|Access Denied|Not Found)/i;
const RECIPE_HEADING_RE = /(菜谱|食谱|食材|材料|用料|配料|做法|步骤|调料|教程)/;
const COOKING_VERB_RE = /(加入|放入|倒入|切|炒|煮|蒸|煎|炸|烤|焖|炖|拌|腌|出锅|焯水|调味|搅拌|翻炒)/g;
const AMOUNT_RE = /\d+(?:\.\d+)?\s*(?:克|g|kg|千克|毫升|ml|升|L|勺|匙|个|只|颗|枚|分钟|小时)/i;

export function unusableRecipeTextReason({ title = "", text = "" } = {}) {
  const body = String(text || "").trim();
  const combined = `${title}\n${body}`;
  if (body.length < 20) return "没抓到足够的文字（可能是登录墙或纯图片帖）";
  if (MISSING_OR_BLOCKED_RE.test(combined)) return "网页显示内容不存在、需要登录或被反爬拦截";
  const cookingVerbCount = body.match(COOKING_VERB_RE)?.length || 0;
  const hasRecipeHeading = RECIPE_HEADING_RE.test(combined);
  const hasAmount = AMOUNT_RE.test(body);
  if (!hasRecipeHeading && !(cookingVerbCount >= 2 && hasAmount)) {
    return "没抓到足够的菜谱文字（可能只抓到了站点导航/页脚）";
  }
  return "";
}

async function fetchHtml(url) {
  let current = await assertPublicUrl(url);
  for (let i = 0; i < 5; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetchWithRetry(current, {
        signal: ctrl.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = await assertPublicUrl(new URL(res.headers.get("location"), current).href);
        continue;
      }
      return await res.text();
    } finally { clearTimeout(t); }
  }
  throw new Error("网页重定向次数过多");
}

// 给一个帖子/文章 URL，尽力抓到 {title, text}。
// 策略：先用 yt-dlp -j 拿标题+简介（B站/抖音等的简介常常就是整份菜谱）；不够再直接抓 HTML。
export async function fetchArticleText(url, { cookiesBrowser } = {}) {
  await assertPublicUrl(url);
  let title = "", text = "";
  try {
    const args = ["-j", "--no-warnings"];
    if (cookiesBrowser) args.push("--cookies-from-browser", cookiesBrowser);
    const info = JSON.parse(await run("yt-dlp", [...args, url]));
    title = info.title || "";
    text = info.description || "";
  } catch { /* 无抽取器/纯图文帖：走 HTML 兜底 */ }

  if (text.trim().length < 40) {
    try {
      const ext = extractFromHtml(await fetchHtml(url));
      title = title || ext.title;
      if (ext.text.length > text.length) text = ext.text;
    } catch { /* 抓不到就返回已有的 */ }
  }
  return { title: title.trim(), text: text.trim() };
}
