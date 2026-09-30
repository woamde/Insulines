import os
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import Request

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "my_app_db")

client: AsyncIOMotorClient = None

async def connect_to_mongo():
    global client
    client = AsyncIOMotorClient(MONGODB_URL)

async def close_mongo_connection():
    global client
    if client:
        client.close()

def get_database(request: Request):
    return request.app.state.db