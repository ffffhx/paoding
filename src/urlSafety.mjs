import dns from "node:dns";
import net from "node:net";

const defaultLookup = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

function cleanHost(hostname) {
  return String(hostname || "").replace(/^\[|\]$/g, "");
}

function parseIPv4(address) {
  const parts = String(address).split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n, i) => !Number.isInteger(n) || n < 0 || n > 255 || String(n) !== parts[i])) return null;
  return nums;
}

export function isPrivateAddress(address) {
  const host = cleanHost(address).toLowerCase();
  const v4 = parseIPv4(host);
  if (v4) {
    const [a, b] = v4;
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }

  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const n = (Number.parseInt(mappedHex[1], 16) << 16) + Number.parseInt(mappedHex[2], 16);
    return isPrivateAddress([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
  }

  if (net.isIP(host) !== 6) return false;
  if (host === "::" || host === "::1" || host === "0:0:0:0:0:0:0:0" || host === "0:0:0:0:0:0:0:1") return true;
  const first = Number.parseInt(host.split(":")[0] || "0", 16);
  if (!Number.isFinite(first)) return false;
  return (first >= 0xfc00 && first <= 0xfdff) || (first >= 0xfe80 && first <= 0xfebf);
}

export async function assertPublicUrl(value, { lookup = defaultLookup } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error("请提供合法 URL"), { statusCode: 400 });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw Object.assign(new Error("只允许 http(s) 链接"), { statusCode: 400 });
  }

  const hostname = cleanHost(url.hostname);
  if (!hostname) throw Object.assign(new Error("URL 缺少主机名"), { statusCode: 400 });

  const family = net.isIP(hostname);
  const records = family ? [{ address: hostname, family }] : await lookup(hostname);
  const addrs = Array.isArray(records) ? records : [records];
  if (!addrs.length) throw Object.assign(new Error("域名没有可用解析地址"), { statusCode: 400 });
  const blocked = addrs.find((r) => isPrivateAddress(r.address));
  if (blocked) {
    throw Object.assign(new Error(`出于安全考虑，拒绝访问本机、内网或链路本地地址：${hostname}`), { statusCode: 400 });
  }
  return url.href;
}
