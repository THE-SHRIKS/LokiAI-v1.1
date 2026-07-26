import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def run():
    pool = await asyncpg.create_pool(os.getenv('DATABASE_URL'))
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name;")
        for r in rows:
            print(f"{r['table_name']}.{r['column_name']} ({r['data_type']})")
    await pool.close()

asyncio.run(run())
