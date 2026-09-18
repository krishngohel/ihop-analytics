import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connections-test-"));
process.env.OPS_DB_PATH = path.join(dir, "ops.db");
for (const k of ["ROSNET_API_USER", "ROSNET_API_KEY", "REPORTS_IMAP_USER", "REPORTS_IMAP_PASSWORD", "REPORTS_IMAP_HOST", "OPS_SECRET_KEY"]) delete process.env[k];
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("secrets entered in the dashboard are encrypted at rest and never described back", async () => {
  const { default: db } = await import("../src/db.js");
  const { saveConnectionValues, describeConnections, connectionValue } = await import("../src/connections.js");
  const { rosnetConfig } = await import("../src/sources/rosnet.js");
  const { mailboxConfig } = await import("../src/mailbox.js");

  assert.equal(rosnetConfig().configured, false);
  saveConnectionValues({ rosnet_api_user: " api-user ", rosnet_api_key: "s3cret-key-value", reports_imap_user: "ihop-reports@gmail.com", reports_imap_password: "app-pass-word", reports_allowed_senders: "rosnet.com", not_a_field: "x" });

  assert.equal(rosnetConfig().configured, true, "takes effect at once, with no restart");
  assert.equal(rosnetConfig().user, "api-user");
  assert.equal(connectionValue("rosnet_api_key"), "s3cret-key-value");
  assert.deepEqual([mailboxConfig().configured, mailboxConfig().host], [true, "imap.gmail.com"], "the mail server is worked out from the address");

  const everything = JSON.stringify(db.prepare("SELECT key, value FROM setting").all());
  assert.ok(!everything.includes("s3cret-key-value") && !everything.includes("app-pass-word"), "no secret is stored in the clear");
  assert.ok(!everything.includes("not_a_field"));
  const described = JSON.stringify(describeConnections());
  assert.ok(!described.includes("s3cret-key-value") && !described.includes("app-pass-word"), "no secret is sent back to the browser");
  assert.deepEqual(describeConnections().rosnet_api_key, { on_file: true, from_environment: false });
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, ".secret-key")).mode & 0o777, 0o600, "the key file is private to the account running the dashboard");

  saveConnectionValues({ rosnet_api_user: "api-user-2", rosnet_api_key: "" });
  assert.equal(connectionValue("rosnet_api_key"), "s3cret-key-value", "a blank secret keeps the one on file");
  saveConnectionValues({ rosnet_api_key: null });
  assert.equal(rosnetConfig().configured, false, "null removes it");

  process.env.ROSNET_API_KEY = "from-env";
  saveConnectionValues({ rosnet_api_key: "ignored" });
  assert.equal(connectionValue("rosnet_api_key"), "from-env", "an environment variable wins, for hosted installs");
  assert.equal(describeConnections().rosnet_api_key.from_environment, true);
  delete process.env.ROSNET_API_KEY;
});
