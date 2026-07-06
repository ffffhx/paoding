const DEFAULT_DELAYS_MS = [1000, 4000];

export async function fetchWithRetry(input, init = {}, {
  fetchImpl = globalThis.fetch,
  retries = 2,
  delaysMs = DEFAULT_DELAYS_MS,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetchWithRetry 需要可用的 fetch");
  const signal = init?.signal;
  const maxRetries = Math.max(0, Number(retries) || 0);
  let attempt = 0;

  while (true) {
    throwIfAborted(signal);
    try {
      const res = await fetchImpl(input, init);
      if (!shouldRetryResponse(res) || attempt >= maxRetries) return res;
      await discardBody(res);
    } catch (e) {
      if (isAbort(signal, e) || attempt >= maxRetries) throw e;
    }
    await sleep(delayFor(delaysMs, attempt), signal);
    attempt++;
  }
}

function shouldRetryResponse(res) {
  return res && (res.status === 429 || res.status >= 500);
}

async function discardBody(res) {
  try {
    if (res.body?.cancel) await res.body.cancel();
    else await res.arrayBuffer?.();
  } catch {
    // 重试前尽力释放连接；释放失败不影响下一次请求。
  }
}

function delayFor(delaysMs, attempt) {
  const list = Array.isArray(delaysMs) && delaysMs.length ? delaysMs : DEFAULT_DELAYS_MS;
  return Math.max(0, Number(list[Math.min(attempt, list.length - 1)]) || 0);
}

function sleep(ms, signal) {
  throwIfAborted(signal);
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortReason(signal));
    };
    function done() {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal) {
  return signal?.reason || new DOMException("The operation was aborted", "AbortError");
}

function isAbort(signal, error) {
  return signal?.aborted || error?.name === "AbortError";
}
