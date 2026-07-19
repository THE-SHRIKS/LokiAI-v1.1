import asyncio
import os
import httpx
from dotenv import load_dotenv

load_dotenv()
NVIDIA_API_KEY = os.getenv('NVIDIA_API_KEY')

async def main():
    async with httpx.AsyncClient() as client:
        r = await client.get('https://integrate.api.nvidia.com/v1/models', headers={'Authorization': f'Bearer {NVIDIA_API_KEY}'})
        print(r.json())

asyncio.run(main())
