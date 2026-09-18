"""Builds the zip to send to the client: python make-release.py

Contains the server, the built frontend, the launchers and the docs. Leaves out anything
private to this machine: the database, .env, demo credentials, imported files, legacy code.
Works on Windows and macOS; the Mac launcher is stored with its executable permission.
Run `npm run build` in client/ first so client/dist is current.
"""
import os
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
NAME = "ihop-operations-dashboard"
OUT = os.path.join(ROOT, "release", f"{NAME}.zip")

INCLUDE = ["server/src", "server/node_modules", "server/package.json", "server/package-lock.json", "server/.env.example",
           "client/dist", "docs", "README.md", "Dockerfile", "Start Dashboard.bat", "Start Dashboard.command", "INSTALL.md"]
SKIP_DIRS = {".git", "legacy", "import", "release", "__pycache__", ".cache"}
SKIP_FILES = {".env", ".secret-key", ".demo-credentials.txt", ".DS_Store"}
SKIP_SUFFIXES = (".db", ".db-wal", ".db-shm", ".log")
EXECUTABLE = {"Start Dashboard.command"}


def files():
    for item in INCLUDE:
        full = os.path.join(ROOT, item)
        if os.path.isfile(full):
            yield full
        elif os.path.isdir(full):
            for base, dirs, names in os.walk(full):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                for n in names:
                    if n in SKIP_FILES or n.endswith(SKIP_SUFFIXES):
                        continue
                    yield os.path.join(base, n)
        else:
            sys.exit(f"Missing: {item}" + ("  (run `npm run build` in client/)" if item == "client/dist" else ""))


os.makedirs(os.path.dirname(OUT), exist_ok=True)
count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for path in files():
        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
        info = zipfile.ZipInfo(f"{NAME}/{rel}", date_time=time.localtime(os.path.getmtime(path))[:6])
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3  # Unix, so macOS keeps the permission bits below
        info.external_attr = (0o755 if os.path.basename(path) in EXECUTABLE else 0o644) << 16
        data = open(path, "rb").read()
        if os.path.basename(path) in EXECUTABLE:
            data = data.replace(b"\r\n", b"\n")  # a CRLF shebang line breaks the script on a Mac
        z.writestr(info, data)
        count += 1
print(f"{count} files, {os.path.getsize(OUT) / 1e6:.1f} MB -> {OUT}")
