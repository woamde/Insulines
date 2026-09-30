"""Create a source-only archive. No database, environment secrets or test tokens."""
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
SKIP = {"node_modules", ".git", ".emergent", ".expo", ".metro-cache", "__pycache__", ".pytest_cache", "dist", "tests"}
SECRETS = re.compile(rb"sk-emergent-[A-Za-z0-9_-]{8,}|ek_[a-f0-9]{24,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----")


def source_files():
    for folder in ("frontend/app", "frontend/src", "frontend/assets", "frontend/public", "frontend/scripts", "installation", "scripts"):
        for path in (ROOT / folder).rglob("*"):
            if not path.is_file() or path.is_symlink() or SKIP.intersection(path.relative_to(ROOT).parts):
                continue
            if (path.name.startswith(".env") and path.name != ".env.example") or path.suffix in {".log", ".zip", ".pem", ".key", ".crt", ".pyc"}:
                continue
            yield path
    yield from (ROOT / "backend").glob("*.py")
    for filename in (
        "backend/requirements.txt", "INSTALLATION_LOCALE.md", ".dockerignore", ".gitignore",
        "frontend/package.json", "frontend/yarn.lock", "frontend/app.json", "frontend/app.config.ts",
        "frontend/metro.config.js", "frontend/babel.config.js", "frontend/tsconfig.json",
        "frontend/eslint.config.js", "frontend/.gitignore", "frontend/eas.json",
    ):
        path = ROOT / filename
        if path.is_file():
            yield path


def main():
    output = ROOT / "dist" / "glycosoin-source.zip"
    output.parent.mkdir(exist_ok=True)
    paths = sorted(set(source_files()))
    # Read and check everything before opening the output file.
    content = []
    for path in paths:
        data = path.read_bytes()
        if SECRETS.search(data):
            raise RuntimeError(f"Possible secret: archive refused ({path.relative_to(ROOT)})")
        content.append(("glycosoin/" + path.relative_to(ROOT).as_posix(), data))
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for name, data in content:
            archive.writestr(name, data)
    print(f"Archive créée : {output} ({len(content)} fichiers, sans données ni fichiers .env)")


if __name__ == "__main__":
    main()