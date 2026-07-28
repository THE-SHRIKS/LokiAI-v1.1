import asyncio
import httpx
from main import _resolve_explicit_repo, _hf_cache_get

async def main():
    async with httpx.AsyncClient() as client:
        # Test 1: Qwen/Qwen2.5-0.5B-Instruct-GGUF
        # Should return at least one real .gguf
        qwen = await _resolve_explicit_repo(client, "Qwen/Qwen2.5-0.5B-Instruct-GGUF", 4000.0)
        print("Qwen test:", "PASS" if qwen.get("ok") and qwen["model"]["format"] == "gguf" else "FAIL", qwen)

        # Test 2: google-bert/bert-base-uncased
        # Should return MODEL_INCOMPATIBLE
        bert = await _resolve_explicit_repo(client, "google-bert/bert-base-uncased", 4000.0)
        print("Bert test:", "PASS" if not bert.get("ok") and bert.get("code") == "MODEL_INCOMPATIBLE" else "FAIL", bert)

        # Test 3: Cache behavior on max_size=0
        # Should NOT cache a negative result if max_size is 0
        bad_ram = await _resolve_explicit_repo(client, "google-bert/bert-base-uncased", 0.0)
        cached = _hf_cache_get("repo|google-bert/bert-base-uncased|0")
        print("Cache test:", "PASS" if cached is None else "FAIL", "Cached:", cached)

if __name__ == "__main__":
    asyncio.run(main())
