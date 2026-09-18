// Sign-in and role-based access. Roles: executive (company-wide), region, area, store.
// Passwords are scrypt-hashed; sessions are random tokens stored hashed, sent as an
// HttpOnly cookie. Nothing here is hard-coded: accounts come from the seed or an admin.
import crypto from "crypto";
import db, { audit } from "./db.js";

// A local desktop install has no login wall: every request is a built-in operator with
// company-wide access, so the role-scoping below still applies (as executive = sees all).
// A hosted or network-shared deployment restores real sign-in with OPS_REQUIRE_LOGIN=1.
export const OPEN_ACCESS = process.env.OPS_REQUIRE_LOGIN !== "1";
const OWNER = { user_id: 0, email: "operator@localhost", display_name: "Operator", role: "executive", scope_id: null };

const COOKIE = "ops_session";
const SESSION_DAYS = 14;
const MAX_ATTEMPTS = 6;
const LOCK_MINUTES = 10;
const attempts = new Map(); // email -> { count, until }

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split("$");
  if (scheme !== "scrypt") return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function cookieHeader(value, maxAgeSeconds) {
  const secure = process.env.COOKIE_SECURE === "1" || process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function publicUser(u) {
  if (!u) return null;
  let scope_name = "All restaurants";
  if (u.role === "region") scope_name = db.prepare("SELECT region_name n FROM region WHERE region_id = ?").get(u.scope_id)?.n;
  if (u.role === "area") scope_name = db.prepare("SELECT area_name n FROM area WHERE area_id = ?").get(u.scope_id)?.n;
  if (u.role === "store") scope_name = db.prepare("SELECT restaurant_name n FROM restaurant WHERE restaurant_id = ?").get(u.scope_id)?.n;
  return { user_id: u.user_id, email: u.email, display_name: u.display_name, role: u.role, scope_id: u.scope_id, scope_name };
}

export function login(req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const lock = attempts.get(email);
  if (lock && lock.count >= MAX_ATTEMPTS && lock.until > Date.now()) {
    return res.status(429).json({ error: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.` });
  }
  const user = db.prepare("SELECT * FROM app_user WHERE email = ? AND is_active = 1").get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    const next = { count: (lock && lock.until > Date.now() ? lock.count : 0) + 1, until: Date.now() + LOCK_MINUTES * 60000 };
    attempts.set(email, next);
    audit(email, "login_failed");
    return res.status(401).json({ error: "Email or password is incorrect" });
  }
  attempts.delete(email);
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  db.prepare("INSERT INTO session (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(sha(token), user.user_id, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 864e5).toISOString());
  db.prepare("DELETE FROM session WHERE expires_at < ?").run(now.toISOString());
  res.setHeader("Set-Cookie", cookieHeader(token, SESSION_DAYS * 86400));
  audit(email, "login");
  res.json({ user: publicUser(user) });
}

export function logout(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare("DELETE FROM session WHERE token_hash = ?").run(sha(token));
  res.setHeader("Set-Cookie", cookieHeader("", 0));
  res.json({ ok: true });
}

export function attachUser(req, _res, next) {
  if (OPEN_ACCESS) { req.user = OWNER; return next(); }
  const token = readCookie(req, COOKIE);
  if (token) {
    req.user = db.prepare(`SELECT u.* FROM session s JOIN app_user u ON u.user_id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`).get(sha(token), new Date().toISOString()) || null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in required" });
  next();
}

export const requireRole = (...roles) => (req, res, next) =>
  (roles.includes(req.user?.role) ? next() : res.status(403).json({ error: "You don't have access to this" }));

/** True when the signed-in user may see this region / area / restaurant. */
export function canAccess(user, { regionId, areaId, restaurantId }) {
  if (user.role === "executive") return true;
  if (restaurantId) {
    const r = db.prepare("SELECT region_id, area_id, restaurant_id FROM restaurant WHERE restaurant_id = ?").get(Number(restaurantId));
    if (!r) return false;
    return (user.role === "region" && r.region_id === user.scope_id) || (user.role === "area" && r.area_id === user.scope_id) || (user.role === "store" && r.restaurant_id === user.scope_id);
  }
  if (areaId) {
    const a = db.prepare("SELECT region_id, area_id FROM area WHERE area_id = ?").get(Number(areaId));
    if (!a) return false;
    return (user.role === "region" && a.region_id === user.scope_id) || (user.role === "area" && a.area_id === user.scope_id);
  }
  if (regionId) return user.role === "region" && Number(regionId) === user.scope_id;
  return false;
}

export function createUser({ email, display_name, role, scope_id = null, password }) {
  db.prepare("INSERT INTO app_user (email, display_name, role, scope_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(String(email).trim().toLowerCase(), display_name, role, role === "executive" ? null : Number(scope_id), hashPassword(password), new Date().toISOString());
}

export function generatePassword() {
  return crypto.randomBytes(9).toString("base64url");
}
