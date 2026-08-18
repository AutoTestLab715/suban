const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hashFormPassword,
  verifyFormPassword,
  sanitizeTemplate,
  stableStringify,
} = require("../formCore");

test("public template sanitizer removes access control and service credentials", () => {
  const template = {
    _id: "tpl-1",
    fields: [{ id: "name", type: "text" }],
    settings: {
      accessPassword: "plain-secret",
      phoneWhitelist: ["13800138000"],
      openidWhitelist: ["openid-1"],
      paymentMchId: "merchant-1",
      smsWebhookUrl: "https://example.invalid/hook",
      smsSecret: "sms-secret",
      smsNotifyPhones: ["13800138000"],
      tencentSecretId: "secret-id",
      tencentSecretKey: "secret-key",
      customApiToken: "token-value",
      normalSetting: "visible",
    },
  };

  const sanitized = sanitizeTemplate(template, false);
  assert.equal(sanitized.settings.needPassword, true);
  assert.equal(sanitized.settings.normalSetting, "visible");
  for (const key of [
    "accessPassword",
    "phoneWhitelist",
    "openidWhitelist",
    "paymentMchId",
    "smsWebhookUrl",
    "smsSecret",
    "smsNotifyPhones",
    "tencentSecretId",
    "tencentSecretKey",
    "customApiToken",
  ]) {
    assert.equal(Object.hasOwn(sanitized.settings, key), false, key);
  }
});

test("admin sanitizer masks hashed password without exposing hash material", () => {
  const hashed = hashFormPassword("correct-password");
  const sanitized = sanitizeTemplate({ settings: { ...hashed, title: "ok" } }, true);
  assert.equal(sanitized.settings.accessPassword, "********");
  assert.equal(sanitized.settings.needPassword, true);
  assert.equal(Object.hasOwn(sanitized.settings, "accessPasswordHash"), false);
  assert.equal(Object.hasOwn(sanitized.settings, "accessPasswordSalt"), false);
});

test("admin sanitizer also masks legacy plaintext password", () => {
  const sanitized = sanitizeTemplate({ settings: { accessPassword: "legacy-secret" } }, true);
  assert.equal(sanitized.settings.accessPassword, "********");
  assert.equal(sanitized.settings.needPassword, true);
});

test("hashed form password verifies correct input and rejects incorrect input", () => {
  const settings = hashFormPassword("correct-password");
  const template = { settings };
  assert.deepEqual(verifyFormPassword(template, "correct-password"), { ok: true });
  assert.equal(verifyFormPassword(template, "wrong-password").ok, false);
});

test("legacy plaintext form password remains compatible", () => {
  const template = { settings: { accessPassword: "legacy-password" } };
  assert.deepEqual(verifyFormPassword(template, "legacy-password"), { ok: true });
  assert.equal(verifyFormPassword(template, "wrong-password").ok, false);
});

test("stableStringify ignores object key insertion order", () => {
  const first = { b: 2, a: { y: [3, { n: 1, m: 2 }], x: true } };
  const second = { a: { x: true, y: [3, { m: 2, n: 1 }] }, b: 2 };
  assert.equal(stableStringify(first), stableStringify(second));
  assert.notEqual(stableStringify(first), stableStringify({ ...second, b: 3 }));
});
