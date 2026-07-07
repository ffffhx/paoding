export function backupFilename(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `paoding-backup-${d.toISOString()}.json`;
}

export function parseBackupTime(name) {
  const m = String(name || "").match(/^paoding-backup-(.+)\.json$/);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : null;
}

export function packBackup({ recipes = [], userFiles = [], createdAt = new Date().toISOString() } = {}) {
  return {
    version: 1,
    created_at: createdAt,
    recipes: recipes.map((r) => ({ ...r })),
    user_files: userFiles
      .map((f) => ({ name: String(f.name || ""), data: f.data, raw: f.raw, error: f.error }))
      .filter((f) => f.name)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function planBackupRotation(files, keep = 7) {
  const n = Math.max(1, Math.floor(Number(keep) || 7));
  return (files || [])
    .map((file) => {
      const name = typeof file === "string" ? file : file?.name;
      return { name, time: parseBackupTime(name) };
    })
    .filter((f) => f.name && f.time !== null)
    .sort((a, b) => b.time - a.time || b.name.localeCompare(a.name))
    .slice(n)
    .map((f) => f.name);
}

export function shouldRunBackup({ latestBackupMs = null, nowMs = Date.now(), intervalHours = 24 } = {}) {
  const hours = Number(intervalHours);
  if (!Number.isFinite(hours) || hours <= 0) return false;
  if (!Number.isFinite(latestBackupMs)) return true;
  return Number(nowMs) - Number(latestBackupMs) >= hours * 60 * 60 * 1000;
}
