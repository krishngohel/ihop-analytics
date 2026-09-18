// Connection settings for the automatic data inputs, entered in the dashboard under Data and
// refresh so nobody edits a file or restarts anything. An environment variable, where one is
// set, still wins: that is how a hosted install keeps its secrets outside the database.
//
// Secrets (the Rosnet API key, the reports mailbox password) are encrypted with AES-256-GCM
// before they go in the database. The encryption key is OPS_SECRET_KEY, or a key file created
// beside the database on first use, so a copy of ops.db on its own gives the secrets to no one.
// They are never sent back to the browser: the API reports only whether one is on file.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getSetting, setSetting } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.OPS_DB_PATH ? path.dirname(path.resolve(process.env.OPS_DB_PATH)) : path.join(__dirname, "..");
const keyFile = path.join(dataDir, ".secret-key");

let cachedKey = null;
function secretKey() {
  if (cachedKey) return cachedKey;
  if (process.env.OPS_SECRET_KEY) return (cachedKey = crypto.createHash("sha256").update(process.env.OPS_SECRET_KEY).digest());
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  return (cachedKey = Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "base64"));
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

function decrypt(stored) {
  try {
    const raw = Buffer.from(stored, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return ""; // the key file was lost or replaced: the secret has to be entered again
  }
}

// name -> { env: the environment variable that overrides it, secret }
const FIELDS = {
  rosnet_api_user: { env: "ROSNET_API_USER" },
  rosnet_api_key: { env: "ROSNET_API_KEY", secret: true },
  rosnet_client_id: { env: "ROSNET_CLIENT_ID" },
  rosnet_portal_user: { env: "ROSNET_PORTAL_USER" },
  rosnet_portal_password: { env: "ROSNET_PORTAL_PASSWORD", secret: true },
  rosnet_portal_client: { env: "ROSNET_PORTAL_CLIENT" },
  rosnet_portal_client_id: { env: "ROSNET_PORTAL_CLIENT_ID" },
  reports_imap_host: { env: "REPORTS_IMAP_HOST" },
  reports_imap_port: { env: "REPORTS_IMAP_PORT" },
  reports_imap_user: { env: "REPORTS_IMAP_USER" },
  reports_imap_password: { env: "REPORTS_IMAP_PASSWORD", secret: true },
  reports_imap_folder: { env: "REPORTS_IMAP_FOLDER" },
  reports_allowed_senders: { env: "REPORTS_ALLOWED_SENDERS" },
  import_dir: { env: "IMPORT_DIR" },
};

/** The value in force: the environment variable if there is one, otherwise what was saved in the dashboard. */
export function connectionValue(name) {
  const field = FIELDS[name];
  if (process.env[field.env]) return process.env[field.env];
  const stored = getSetting(`connection.${name}`);
  if (!stored) return "";
  return field.secret ? decrypt(stored) : stored;
}

export const fromEnvironment = (name) => Boolean(process.env[FIELDS[name].env]);

/** Saves what the form sent. A secret left blank keeps the one on file; `null` removes it. */
export function saveConnectionValues(values) {
  const saved = [];
  for (const [name, value] of Object.entries(values || {})) {
    const field = FIELDS[name];
    if (!field || fromEnvironment(name)) continue;
    if (field.secret && value === "") continue;
    const text = value === null || value === undefined ? "" : String(value).trim();
    setSetting(`connection.${name}`, text && field.secret ? encrypt(text) : text);
    saved.push(name);
  }
  return saved;
}

/** What the settings screen shows. Secrets appear only as "on file" or not. */
export function describeConnections() {
  const out = {};
  for (const [name, field] of Object.entries(FIELDS)) {
    const value = connectionValue(name);
    out[name] = field.secret ? { on_file: Boolean(value), from_environment: fromEnvironment(name) } : { value, from_environment: fromEnvironment(name) };
  }
  return out;
}

// Well-known mail hosts, so the form only has to ask for an address and a password.
const MAIL_HOSTS = [
  [/@(gmail|googlemail)\.com$/i, "imap.gmail.com"],
  [/@(outlook|hotmail|live|msn)\.[a-z.]+$/i, "outlook.office365.com"],
  [/@(yahoo|ymail)\.[a-z.]+$/i, "imap.mail.yahoo.com"],
  [/@(icloud|me|mac)\.com$/i, "imap.mail.me.com"],
  [/@aol\.com$/i, "imap.aol.com"],
  [/@zoho\.[a-z.]+$/i, "imap.zoho.com"],
  [/@fastmail\.[a-z.]+$/i, "imap.fastmail.com"],
];
export const guessMailHost = (address) => MAIL_HOSTS.find(([re]) => re.test(String(address || "")))?.[1] || "";
