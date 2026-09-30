"""Optional same-origin web serving for the local Windows/Ubuntu installation.

Disabled in the existing mobile preview unless WEB_DIST_DIR is explicitly set.
"""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from starlette.responses import FileResponse


def register_local_web(app: FastAPI, directory: str) -> None:
    root = Path(directory).resolve()
    if not (root / "index.html").is_file():
        raise RuntimeError("WEB_DIST_DIR must contain the exported web index.html")

    @app.get("/{web_path:path}", include_in_schema=False)
    async def web_file(web_path: str):
        if web_path == "api" or web_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Route API introuvable")
        target = (root / (web_path or "index.html")).resolve()
        if not target.is_relative_to(root) or any(p.startswith(".") for p in Path(web_path).parts):
            raise HTTPException(status_code=404, detail="Fichier introuvable")
        if not target.is_file():
            if Path(web_path).suffix:
                raise HTTPException(status_code=404, detail="Fichier introuvable")
            target = root / "index.html"  # Expo Router deep links
        media_type = "application/manifest+json" if target.suffix == ".webmanifest" else None
        return FileResponse(target, media_type=media_type, headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        })