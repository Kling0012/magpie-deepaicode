import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { desktopBaseDirs, desktopSecretDirs, findDesktopCredentials, parseCredentials } from "../src/credentials.mjs";

function makeBase(files) {
  const base = mkdtempSync(join(tmpdir(), "deepaicode-"));
  for (const [rel, content] of Object.entries(files)) {
    const path = join(base, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return base;
}

test("parseCredentials：正常/异常", () => {
  const cred = parseCredentials('{"apiKey":" 3f2b9a10-8c44-4d7e-9a1b-2c3d4e5f6a7b ","username":"ada","isPro":true}');
  assert.equal(cred.apiKey, "3f2b9a10-8c44-4d7e-9a1b-2c3d4e5f6a7b");
  assert.equal(cred.username, "ada");
  assert.equal(cred.isPro, true);

  assert.throws(() => parseCredentials("{not json"));
  assert.throws(() => parseCredentials('{"username":"x"}'), /missing-api-key/);
  assert.throws(() => parseCredentials('{"apiKey":"a b"}'), /invalid-api-key/);
});

test("desktopBaseDirs：环境变量优先于 ~/.deepai-code", () => {
  const dirs = desktopBaseDirs({ env: { T3CODE_HOME: "C:\\t3", DEEPAI_CODE_HOME: "C:\\d" }, home: "C:\\home" });
  assert.deepEqual(dirs.slice(0, 2), ["C:\\t3", "C:\\d"]);
  assert.ok(dirs.includes(join("C:\\home", ".deepai-code")));
});

test("desktopSecretDirs：三个候选且去重", () => {
  const dirs = desktopSecretDirs("C:\\base");
  assert.deepEqual(dirs, [
    join("C:\\base", "userdata", "secrets"),
    join("C:\\base", "secrets"),
    join("C:\\base", "dev", "secrets"),
  ]);
  assert.deepEqual(desktopSecretDirs(""), []);
});

test("findDesktopCredentials：按优先级找到 userdata/secrets 的凭据", () => {
  const base = makeBase({
    "userdata/secrets/deepai-account.bin": '{"apiKey":"k-1","username":"ada"}',
    "secrets/deepai-account.bin": '{"apiKey":"k-2"}',
  });
  const found = findDesktopCredentials({ env: { T3CODE_HOME: base } });
  assert.equal(found.ok, true);
  assert.equal(found.cred.apiKey, "k-1");
  rmSync(base, { recursive: true, force: true });
});

test("findDesktopCredentials：首页文件缺失时回落 user-managed", () => {
  const base = makeBase({
    "userdata/secrets/deepai-account-user-managed.bin": '{"apiKey":"managed"}',
  });
  const found = findDesktopCredentials({ env: { T3CODE_HOME: base } });
  assert.equal(found.ok, true);
  assert.equal(found.cred.apiKey, "managed");
  rmSync(base, { recursive: true, force: true });
});

test("findDesktopCredentials：显式文件路径优先", () => {
  const base = makeBase({ "any/deepai-account.bin": '{"apiKey":"explicit"}' });
  const file = join(base, "any", "deepai-account.bin");
  const found = findDesktopCredentials({ explicit: file, env: {} });
  assert.equal(found.ok, true);
  assert.equal(found.cred.apiKey, "explicit");
  rmSync(base, { recursive: true, force: true });
});

test("findDesktopCredentials：坏 JSON 报路径与原因", () => {
  const base = makeBase({ "userdata/secrets/deepai-account.bin": "{bad" });
  const found = findDesktopCredentials({ env: { T3CODE_HOME: base }, home: "C:\nope-home" });
  assert.equal(found.ok, false);
  assert.ok(found.path);
  assert.match(found.reason, /bad-json/);
  rmSync(base, { recursive: true, force: true });
});

test("findDesktopCredentials：都没有时给出尝试过的路径", () => {
  const found = findDesktopCredentials({ env: { T3CODE_HOME: "C:\\nope" }, home: "C:\\nope-home" });
  assert.equal(found.ok, false);
  assert.ok(found.tried.length >= 6);
  assert.ok(found.tried[0].includes("userdata"));
});
