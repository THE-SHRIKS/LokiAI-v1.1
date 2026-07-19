import asyncio
import os
import httpx
from dotenv import load_dotenv

load_dotenv()
NVIDIA_API_KEY = os.getenv('NVIDIA_API_KEY')

async def main():
    async with httpx.AsyncClient() as client:
        r = await client.get('https://integrate.api.nvidia.com/v1/models', headers={'Authorization': f'Bearer {NVIDIA_API_KEY}'})
        data = r.json()
        print([m['id'] for m in data['data'] if 'llama' in m['id'].lower() or 'meta' in m['id'].lower()])

asyncio.run(main())
