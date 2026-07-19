import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

async def run():
    url = os.getenv('DATABASE_URL')
    if url and url.startswith("postgresql+asyncpg://"):
        url = url.replace("+asyncpg", "")
    conn = await asyncpg.connect(url)
    await conn.execute("UPDATE devices SET user_id='5d7f3b7a-6c25-4ac6-a389-ac237c513959' WHERE adb_serial='nffywkhinf4hfyn7'")
    print('Updated')
    await conn.close()

asyncio.run(run())
