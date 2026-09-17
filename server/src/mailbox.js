// Reports mailbox. Most vendor platforms can email a report on a schedule even when they
// offer no API, so the dashboard reads a dedicated inbox: the vendor system sends the daily
// sales, labor and guest reports there, and every refresh imports the attachments. Nothing
// logs in to the vendor. The mailbox password lives in an environment variable only.
//
//   REPORTS_IMAP_HOST, REPORTS_IMAP_PORT (993), REPORTS_IMAP_USER, REPORTS_IMAP_PASSWORD
//   REPORTS_IMAP_FOLDER (INBOX)
//   REPORTS_ALLOWED_SENDERS  comma list of addresses or domains, e.g. "rosnet.com,reports@client.com"
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { audit } from "./db.js";
import { ingestFile } from "./imports.js";

const REPORT_FILE = /\.(csv|xlsx|xls)$/i;

export function mailboxConfig() {
  const host = process.env.REPORTS_IMAP_HOST;
  const user = process.env.REPORTS_IMAP_USER;
  const allowed = (process.env.REPORTS_ALLOWED_SENDERS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    configured: Boolean(host && user && process.env.REPORTS_IMAP_PASSWORD),
    host: host || null, user: user || null, folder: process.env.REPORTS_IMAP_FOLDER || "INBOX", allowed,
  };
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
  if (!cfg.allowed.length) throw new Error("REPORTS_ALLOWED_SENDERS is empty, so no sender is trusted. Add the vendor's sending address or domain.");
  const client = new ImapFlow({
    host: cfg.host, port: Number(process.env.REPORTS_IMAP_PORT) || 993, secure: true,
    auth: { user: cfg.user, pass: process.env.REPORTS_IMAP_PASSWORD }, logger: false,
  });
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
