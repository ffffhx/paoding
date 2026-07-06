import dns from "node:dns";
import net from "node:net";

const defaultLookup = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

function cleanHost(hostname) {
  return String(hostname || "").replace(/^\[|\]$/g, "").replace(/%.+$/, "");
}

function parseIPv4(address) {
  const parts = String(address).split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n, i) => !Number.isInteger(n) || n < 0 || n > 255 || String(n) !== parts[i])) return null;
  return nums;
}

function ipv4ToNumber(parts) {
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function ipv4InCidr(parts, base, bits) {
  const start = ipv4ToNumber(parseIPv4(base));
  const size = 2 ** (32 - bits);
  const n = ipv4ToNumber(parts);
  return n >= start && n < start + size;
}

function parseIPv6(address) {
  const raw = String(address || "").toLowerCase();
  if (!raw.includes(":")) return null;
  let s = raw;
  const embeddedV4 = s.match(/(.+:)(\d+\.\d+\.\d+\.\d+)$/);
  if (embeddedV4) {
    const v4 = parseIPv4(embeddedV4[2]);
    if (!v4) return null;
    s = `${embeddedV4[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const pieces = s.split("::");
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
  const fill = pieces.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (pieces.length === 1 && left.length !== 8)) return null;
  const groups = [...left, ...Array(fill).fill("0"), ...right];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) + BigInt(Number.parseInt(g, 16));
  }
  return n;
}

function ipv6InCidr(address, base, bits) {
  const addr = parseIPv6(address);
  const start = parseIPv6(base);
  if (addr === null || start === null) return false;
  const shift = BigInt(128 - bits);
  return (addr >> shift) === (start >> shift);
}

export function isPrivateAddress(address) {
  const host = cleanHost(address).toLowerCase();
  const v4 = parseIPv4(host);
  if (v4) {
    return [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.88.99.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([base, bits]) => ipv4InCidr(v4, base, bits));
  }

  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const n = (Number.parseInt(mappedHex[1], 16) << 16) + Number.parseInt(mappedHex[2], 16);
    return isPrivateAddress([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
  }

  if (net.isIP(host) !== 6) return false;
  return [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ].some(([base, bits]) => ipv6InCidr(host, base, bits));
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
