export function shouldFallbackVideoUrlToText(error) {
  const msg = String(error?.message || error || "");
  return /(^|[^A-Za-z0-9_-])yt-dlp([^A-Za-z0-9_-]|$)/i.test(msg)
    || /未找到 yt-dlp|视频下载失败/i.test(msg);
}
