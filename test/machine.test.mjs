import test from "node:test";
import assert from "node:assert/strict";

import {
  detectDeviceRaw,
  machineFingerprint,
  parseUuid,
  sha256Hex,
} from "../src/machine.mjs";

test("sha256Hex：稳定小写 64 位（不改输入大小写）", () => {
  const upper = sha256Hex("ABC");
  const lower = sha256Hex("abc");
  assert.match(upper, /^[0-9a-f]{64}$/);
  assert.match(lower, /^[0-9a-f]{64}$/);
  assert.notEqual(upper, lower);
  assert.equal(sha256Hex("abc"), sha256Hex("abc"));
});

test("machineFingerprint：先小写去空白再 sha256；空值返回空串", () => {
  const fp = machineFingerprint("  AABBCCDD-1122-3344-5566-77889900AABB ");
  assert.equal(fp, sha256Hex("aabbccdd-1122-3344-5566-77889900aabb"));
  assert.equal(machineFingerprint(""), "");
  assert.equal(machineFingerprint(null), "");
});

test("parseUuid：提取并过滤固件占位值", () => {
  assert.equal(parseUuid("UUID: ABCDEF01-2345-6789-ABCD-EF0123456789"), "abcdef01-2345-6789-abcd-ef0123456789");
  assert.equal(parseUuid("00000000-0000-0000-0000-000000000000"), "");
  assert.equal(parseUuid("ffffffff-ffff-ffff-ffff-ffffffffffff"), "");
  assert.equal(parseUuid("nothing here"), "");
});

test("detectDeviceRaw：DEEPAI_MACHINE_ID 覆盖优先", () => {
  assert.equal(detectDeviceRaw({ env: { DEEPAI_MACHINE_ID: "abc-123" }, platform: "linux" }), "abc-123");
});

test("detectDeviceRaw：Windows 走 WMI，失败回落 MachineGuid", () => {
  const wmi = detectDeviceRaw({
    platform: "win32",
    run: (cmd) => (cmd === "powershell" ? "11111111-2222-3333-4444-555555555555" : ""),
  });
  assert.equal(wmi, "11111111-2222-3333-4444-555555555555");

  const reg = detectDeviceRaw({
    platform: "win32",
    run: (cmd) => (cmd === "reg" ? "    MachineGuid    REG_SZ    99999999-8888-7777-6666-555555555555" : ""),
  });
  assert.equal(reg, "99999999-8888-7777-6666-555555555555");
});

test("detectDeviceRaw：Linux 读 product_uuid，回落 machine-id", () => {
  const uuid = detectDeviceRaw({
    platform: "linux",
    read: (path) => (path === "/sys/class/dmi/id/product_uuid" ? "aabbccdd-1122-3344-5566-77889900aabb" : ""),
  });
  assert.equal(uuid, "aabbccdd-1122-3344-5566-77889900aabb");

  const machineId = detectDeviceRaw({
    platform: "linux",
    read: (path) => (path === "/etc/machine-id" ? "deadbeefdeadbeefdeadbeefdeadbeef" : ""),
  });
  assert.equal(machineId, "deadbeefdeadbeefdeadbeefdeadbeef");
});

test("detectDeviceRaw：占位 UUID 视为探测失败", () => {
  const empty = detectDeviceRaw({
    platform: "win32",
    run: (cmd) => (cmd === "powershell" ? "00000000-0000-0000-0000-000000000000" : ""),
  });
  assert.equal(empty, "");
});
