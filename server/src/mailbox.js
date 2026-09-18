// Reports mailbox. Most vendor platforms can email a report on a schedule even when they
// offer no API, so the dashboard reads a dedicated inbox: the vendor system sends the daily
// sales, labor and guest reports there, and every refresh imports the attachments. Nothing
// logs in to the vendor. The mailbox is set up under Data and refresh (password stored
// encrypted, see connections.js), or with these environment variables on a hosted install:
//   REPORTS_IMAP_HOST, REPORTS_IMAP_PORT (993), REPORTS_IMAP_USER, REPORTS_IMAP_PASSWORD
//   REPORTS_IMAP_FOLDER (INBOX)
//   REPORTS_ALLOWED_SENDERS  comma list of addresses or domains, e.g. "rosnet.com,reports@client.com"
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { audit } from "./db.js";
import { ingestFile } from "./imports.js";
import { connectionValue, guessMailHost } from "./connections.js";

const REPORT_FILE = /\.(csv|xlsx|xls)$/i;

export function mailboxConfig() {
  const user = connectionValue("reports_imap_user");
  const host = connectionValue("reports_imap_host") || guessMailHost(user);
  const allowed = connectionValue("reports_allowed_senders").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    configured: Boolean(host && user && connectionValue("reports_imap_password")),
    host: host || null, user: user || null, folder: connectionValue("reports_imap_folder") || "INBOX", allowed,
    port: Number(connectionValue("reports_imap_port")) || 993,
  };
}

const imapClient = (cfg, password) => new ImapFlow({ host: cfg.host, port: cfg.port, secure: true, auth: { user: cfg.user, pass: password }, logger: false });

/**
 * "Test connection": signs in to the mailbox with the values given (or the saved ones) and
 * lists who the latest messages with attachments came from, so the trusted-sender list can
 * be filled by picking from real mail instead of guessing the vendor's sending address.
 */
export async function testMailbox(override = {}) {
  const saved = mailboxConfig();
  const user = override.user || saved.user;
  const cfg = { ...saved, user, host: override.host || (override.user ? guessMailHost(override.user) : "") || saved.host, port: Number(override.port) || saved.port };
  const password = override.password || connectionValue("reports_imap_password");
  if (!cfg.user || !password) throw new Error("Enter the mailbox address and its app password.");
  if (!cfg.host) throw new Error("Couldn't work out the mail server for that address. Enter the IMAP server name.");
  const client = imapClient(cfg, password);
  try {
    await client.connect();
  } catch (e) {
    if (e.authenticationFailed && /office365|outlook|hotmail|live\.com/i.test(cfg.host)) throw new Error("Microsoft mailboxes no longer accept a password for this kind of access. Create a free Gmail account just for reports and use it here instead.");
    throw new Error(e.authenticationFailed ? "The mailbox refused that password. Most providers need an app password here, not the normal one (Gmail: myaccount.google.com/apppasswords, with 2-Step Verification on)." : `Couldn't reach ${cfg.host}: ${e.message}`);
  }
  try {
    const lock = await client.getMailboxLock(cfg.folder);
    try {
      const total = client.mailbox.exists || 0;
      const senders = new Map();
      if (total) {
        for await (const msg of client.fetch(`${Math.max(1, total - 24)}:*`, { envelope: true })) {
          const from = msg.envelope?.from?.[0]?.address?.toLowerCase();
          if (from) senders.set(from, (senders.get(from) || 0) + 1);
        }
      }
      return { host: cfg.host, messages: total, recent_senders: [...senders.keys()].slice(-8).reverse() };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

export function senderAllowed(address, allowed) {
  const a = String(address || "").toLowerCase();
  if (!a) return false;
  // With no list configured nothing is trusted: an open inbox would let anyone inject numbers.
  return allowed.some((rule) => (rule.includes("@") ? a === rule : a.endsWith(`@${rule}`) || a.endsWith(`.${rule}`)));
}

/** Imports the report attachments of one parsed message. Exported so it can be tested without a mail server. */
export function ingestMessage(mail, allowed) {
  const from = mail.from?.value?.[0]?.address || "";
  if (!senderAllowed(from, allowed)) {
    audit(null, "mailbox_sender_ignored", `${from}: "${mail.subject || ""}"`);
    return { from, ignored: true, files: [] };
  }
  const attachments = (mail.attachments || []).filter((a) => REPORT_FILE.test(a.filename || ""));
  // Some systems put the report in the message itself as an HTML table. Read it like a file,
  // named after the subject so a date in the subject line can stand in for a date column.
  if (!attachments.length && /<table[\s>]/i.test(mail.html || "")) {
    attachments.push({ filename: `${(mail.subject || "report").replace(/\//g, "-").replace(/[\\:*?"<>|]+/g, " ").trim()}.html`, content: Buffer.from(mail.html, "utf8") });
  }
  const unreadable = (mail.attachments || []).filter((a) => !REPORT_FILE.test(a.filename || "") && /\.(pdf|zip|docx?)$/i.test(a.filename || "")).map((a) => a.filename);
  if (!attachments.length && unreadable.length) {
    audit(null, "mailbox_unreadable_attachment", `${from}: ${unreadable.join(", ")}. Schedule the report as Excel or CSV.`);
    return { from, subject: mail.subject || "", ignored: false, files: [], unreadable };
  }
  // Sales/labor before guest metrics, for the same reason as the watched folder.
  attachments.sort((a, b) => /guest|review|survey/i.test(a.filename) - /guest|review|survey/i.test(b.filename));
  const files = attachments.map((a) => {
    const r = ingestFile(a.content, { channel: "mailbox", filename: a.filename, sender: from });
    return { file: a.filename, imported: r.imported, skipped: r.skipped, status: r.status, errors: r.errors.slice(0, 3) };
  });
  return { from, subject: mail.subject || "", ignored: false, files };
}

/** Reads unseen messages, imports their attachments, marks them seen. */
export async function importMailbox() {
  const cfg = mailboxConfig();
  if (!cfg.configured) return { configured: false, messages: [] };
  if (!cfg.allowed.length) throw new Error("No trusted senders are listed, so no email is imported. Add the vendor's sending address or domain under Data and refresh.");
  const client = imapClient(cfg, connectionValue("reports_imap_password"));
  const messages = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock(cfg.folder);
    try {
      const unseen = await client.search({ seen: false }, { uid: true });
      for (const uid of (unseen || []).slice(0, 50)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        const mail = await simpleParser(msg.source);
        messages.push(ingestMessage(mail, cfg.allowed));
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return { configured: true, messages };
}
