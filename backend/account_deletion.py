"""Permanent, retryable removal of the authenticated application's account."""
import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)


class AccountDeletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation: Literal["SUPPRIMER"]


class AccountDeletionResponse(BaseModel):
    ok: bool = True


async def erase_photos(db, user_id, erase_object, app_name):
    # Includes soft-deleted meals and photos uploaded without saving a meal.
    paths = set(await db.uploads.distinct("path", {"user_id": user_id}))
    paths.update(await db.meals.distinct("photo_path", {"user_id": user_id}))
    for path in paths:
        if not isinstance(path, str) or not path:
            continue
        if not path.startswith(f"{app_name}/uploads/") or ".." in path.split("/"):
            raise ValueError("Unrecognized photo path")
        owner = await db.uploads.find_one({"path": path}, {"_id": 0, "user_id": 1, "erased": 1})
        if owner and owner["user_id"] != user_id:
            continue  # A foreign reference never authorizes erasure of its object.
        if not owner:
            foreign = await db.meals.find_one({"photo_path": path, "user_id": {"$ne": user_id}}, {"_id": 0, "user_id": 1})
            if foreign:
                continue
        if owner and owner.get("erased"):
            continue
        # Managed storage has no DELETE API. Overwrite the image with zero bytes:
        # the content is erased, only an empty non-image object remains upstream.
        await run_in_threadpool(erase_object, path)
        await db.uploads.update_one(
            {"path": path, "user_id": user_id},
            {"$set": {"erased": True}}, upsert=True,
        )


def register_account_deletion(router: APIRouter, db, get_current_user, erase_object, app_name):
    @router.delete("/auth/account", response_model=AccountDeletionResponse)
    async def delete_account(body: AccountDeletionRequest, user: dict = Depends(get_current_user)):
        uid = user["user_id"]  # Never accept a user ID/e-mail from the client.
        scope = {"user_id": uid}
        await db.users.update_one(scope, {"$set": {
            "account_deletion_pending": True,
            "deletion_started_at": datetime.now(timezone.utc),
        }})
        try:
            await erase_photos(db, uid, erase_object, app_name)
            # Each personal record is user_id scoped, including future collections.
            # Keep identity and tokens until erasure completes, allowing retries.
            names = await db.list_collection_names()
            for name in names:
                if name not in ("users", "user_sessions") and not name.startswith("system."):
                    await db[name].delete_many(scope)
            await db.user_sessions.delete_many(scope)
            # Identity last: if this final operation fails, a fresh Google session
            # can still resume deletion of the pending account.
            await db.users.delete_one(scope)
        except Exception as exc:
            # No secrets, storage URLs, e-mail addresses or tokens in diagnostics.
            logger.error("Account erasure incomplete (%s)", type(exc).__name__)
            raise HTTPException(status_code=503, detail=(
                "La suppression n'a pas pu être terminée. Votre compte reste bloqué "
                "pour protéger vos données. Réessayez pour terminer l'effacement."
            )) from None
        return AccountDeletionResponse()