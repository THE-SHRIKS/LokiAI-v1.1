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
    await conn.execute("DELETE FROM devices WHERE adb_serial='nffywkhinf4hfyn7'")
    print('Deleted')
    await conn.close()

asyncio.run(run())
