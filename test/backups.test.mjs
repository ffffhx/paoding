import { test } from "node:test";
import assert from "node:assert/strict";
import { backupFilename, packBackup, parseBackupTime, planBackupRotation, shouldRunBackup } from "../src/backups.mjs";

test("packBackup 打包全部菜谱和用户文件", () => {
  const backup = packBackup({
    createdAt: "2026-07-07T00:00:00.000Z",
    recipes: [{ id: "a", title: "菜A" }],
    userFiles: [
      { name: "ud-bob.json", data: { rev: 2 } },
      { name: "ud.json", data: { rev: 1 } },
    ],
  });
  assert.equal(backup.version, 1);
  assert.equal(backup.created_at, "2026-07-07T00:00:00.000Z");
  assert.deepEqual(backup.recipes, [{ id: "a", title: "菜A" }]);
  assert.deepEqual(backup.user_files.map((f) => f.name), ["ud-bob.json", "ud.json"]);
});

test("backupFilename 和 parseBackupTime 使用 ISO 时间", () => {
  const name = backupFilename(new Date("2026-07-07T01:02:03.004Z"));
  assert.equal(name, "paoding-backup-2026-07-07T01:02:03.004Z.json");
  assert.equal(parseBackupTime(name), Date.parse("2026-07-07T01:02:03.004Z"));
  assert.equal(parseBackupTime("other.json"), null);
});

test("planBackupRotation 只删除超出保留数的旧备份", () => {
  const files = [
    "paoding-backup-2026-07-07T00:00:00.000Z.json",
    "paoding-backup-2026-07-08T00:00:00.000Z.json",
    "paoding-backup-2026-07-09T00:00:00.000Z.json",
    "notes.txt",
  ];
  assert.deepEqual(planBackupRotation(files, 2), [
    "paoding-backup-2026-07-07T00:00:00.000Z.json",
  ]);
});

test("shouldRunBackup 支持首次、过期和 interval=0 关闭", () => {
  const now = Date.parse("2026-07-07T12:00:00.000Z");
  assert.equal(shouldRunBackup({ latestBackupMs: null, nowMs: now, intervalHours: 24 }), true);
  assert.equal(shouldRunBackup({ latestBackupMs: now - 23 * 60 * 60 * 1000, nowMs: now, intervalHours: 24 }), false);
  assert.equal(shouldRunBackup({ latestBackupMs: now - 25 * 60 * 60 * 1000, nowMs: now, intervalHours: 24 }), true);
  assert.equal(shouldRunBackup({ latestBackupMs: null, nowMs: now, intervalHours: 0 }), false);
});
