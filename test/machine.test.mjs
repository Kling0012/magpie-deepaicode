import test from "node:test";
import assert from "node:assert/strict";

import {
  accountMachineId,
  detectDeviceRaw,
  machineFingerprint,
  parseUuid,
  sha256Hex,
  uuidV5,
} from "../src/machine.mjs";

const KEY = "3f2b9a10-8c44-4d7e-9a1b-2c3d4e5f6a7b";

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

test("uuidV5：确定性 + 版本/变体位", () => {
  const a = uuidV5("hello");
  const b = uuidV5("hello");
  assert.equal(a, b);
  assert.notEqual(a, uuidV5("world"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("accountMachineId：同一 Key 稳定，不同 Key 不同", () => {
  const a1 = accountMachineId(KEY);
  const a2 = accountMachineId(KEY);
  const b = accountMachineId("aabbccdd-1122-3344-5566-77889900aabb");
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.match(a1, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
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
