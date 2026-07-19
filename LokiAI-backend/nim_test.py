import asyncio
import os
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()
NVIDIA_API_KEY = os.getenv('NVIDIA_API_KEY')

async def main():
    try:
        openai_client = AsyncOpenAI(
            base_url="https://integrate.api.nvidia.com/v1",
            api_key=NVIDIA_API_KEY
        )
        completion = await openai_client.chat.completions.create(
            model="meta/llama3-70b-instruct",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=10
        )
        print(completion.choices[0].message.content)
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(main())
