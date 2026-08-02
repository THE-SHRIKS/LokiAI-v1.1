"""Multi-intent planner, constraint, and model-description tests.

Standalone (this project has no pytest dependency) and offline: everything
here is pure function behaviour, so it runs in CI or on a laptop without a
database, a HuggingFace token, or an NVIDIA key.

Run:  python test_infra/planner_test.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # noqa: E402

FAILURES = []
CHECKS = 0


def check(condition, label, detail=""):
    global CHECKS
    CHECKS += 1
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}" + (f"\n        {detail}" if detail else ""))
        FAILURES.append(label)


# ---------------------------------------------------------------------------
# Section 10: multi-intent planning
# ---------------------------------------------------------------------------

def test_multi_intent_prompts():
    print("\n== multi-intent prompts (section 10) ==")

    # The five prompts named in the repair plan, plus the regression case.
    cases = [
        (
            "Find a vision model and a chat model.",
            {"image-classification", "text-generation"},
        ),
        (
            "Recommend two image models and one speech model.",
            {"image-classification", "automatic-speech-recognition"},
        ),
        (
            "I need OCR, object detection, and a small chat model.",
            {"object-detection", "text-generation"},
        ),
        (
            "Give me models for camera recognition and voice input.",
            {"image-classification", "automatic-speech-recognition"},
        ),
        (
            "I want a chatbot and something to identify sounds.",
            {"text-generation", "audio-classification"},
        ),
        (
            "detect objects with my camera and also chat offline",
            {"object-detection", "text-generation"},
        ),
    ]
    for message, expected in cases:
        plan = main.classify_task_plan(message)
        capabilities = {t["capability"] for t in plan}
        check(
            expected.issubset(capabilities),
            f"plan covers every requirement: {message!r}",
            f"expected {sorted(expected)} within {sorted(capabilities)}",
        )
        check(
            len(plan) >= 2,
            f"more than the first keyword survives: {message!r}",
            f"plan={plan}",
        )

    # The exact regression: the old chain of early returns matched the vision
    # branch and returned before ever considering "chat model".
    legacy = main.classify_tasks("Find a vision model and a chat model.")
    check(
        "text-generation" in legacy,
        "the flat compatibility wrapper is multi-intent too",
        f"got {legacy}",
    )


def test_quantities_and_order():
    print("\n== quantities and ordering ==")

    plan = main.classify_task_plan("Recommend two image models and one speech model.")
    by_capability = {t["capability"]: t for t in plan}
    check(
        by_capability.get("image-classification", {}).get("quantity") == 2,
        "requested count of 2 is preserved",
        f"plan={plan}",
    )
    check(
        by_capability.get("automatic-speech-recognition", {}).get("quantity") == 1,
        "requested count of 1 is preserved",
        f"plan={plan}",
    )

    ordered = main.classify_task_plan("I want a chatbot and a camera model")
    check(
        ordered[0]["capability"] == "text-generation",
        "tasks come back in the order the user asked for them",
        f"plan={ordered}",
    )

    empty = main.classify_task_plan("hello there")
    check(len(empty) == 1, "an unrecognised message still yields one task")
    check(
        all(t["quantity"] >= 1 for t in main.classify_task_plan("models please")),
        "quantity is never zero, so a requirement cannot be dropped",
    )


def test_plan_schema_validation():
    print("\n== strict planner-output validation ==")

    current = main._validate_task_plan({
        "tasks": [
            {"capability": "image-classification", "quantity": 2,
             "constraints": {"max_size_mb": 50}},
            {"capability": "text-generation", "quantity": 1, "constraints": {}},
        ]
    })
    check(len(current) == 2, "current schema accepted", f"{current}")
    check(current[0]["quantity"] == 2, "quantity carried through")
    check(current[0]["constraints"] == {"max_size_mb": 50}, "constraints carried through")

    legacy_array = main._validate_task_plan(
        {"tasks": ["image-classification", "text-generation"]}
    )
    check(len(legacy_array) == 2, "legacy flat array still accepted")
    check(
        all(t["quantity"] == 1 for t in legacy_array),
        "legacy entries default to quantity 1",
    )

    legacy_single = main._validate_task_plan({"task": "audio-classification"})
    check(
        legacy_single == [{"capability": "audio-classification", "quantity": 1,
                           "constraints": {}}],
        "original single-task schema still accepted",
        f"{legacy_single}",
    )

    check(main._validate_task_plan({}) == [], "empty object yields an empty plan")
    check(main._validate_task_plan("nonsense") == [], "non-object yields an empty plan")
    check(
        main._validate_task_plan({"tasks": ["not-a-real-task", 42, None]}) == [],
        "unknown capabilities are discarded, not passed downstream",
    )
    check(
        main._validate_task_plan({
            "tasks": [{"capability": "text-generation", "quantity": 99,
                       "constraints": {"evil": "x", "max_size_mb": 10}}]
        }) == [{"capability": "text-generation", "quantity": 5,
                "constraints": {"max_size_mb": 10}}],
        "quantity is clamped and unknown constraint keys are dropped",
    )

    merged = main._validate_task_plan({
        "tasks": [
            {"capability": "text-generation", "quantity": 1, "constraints": {}},
            {"capability": "text-generation", "quantity": 2, "constraints": {}},
        ]
    })
    check(
        merged == [{"capability": "text-generation", "quantity": 3, "constraints": {}}],
        "a repeated capability merges rather than searching the same pool twice",
        f"{merged}",
    )


def test_constraint_filtering():
    print("\n== constraint application ==")

    models = [
        {"id": "a/one", "size_mb": 20, "format": "gguf", "filename": "m-q4_k_m.gguf"},
        {"id": "a/two", "size_mb": 200, "format": "gguf", "filename": "m-q8.gguf"},
        {"id": "a/three", "size_mb": 5, "format": "tflite", "filename": "m.tflite"},
    ]
    check(
        [m["id"] for m in main._apply_task_constraints(models, {"max_size_mb": 50})]
        == ["a/one", "a/three"],
        "max_size_mb filters on the measured CDN size",
    )
    check(
        [m["id"] for m in main._apply_task_constraints(models, {"format": "tflite"})]
        == ["a/three"],
        "format constraint honoured",
    )
    check(
        [m["id"] for m in main._apply_task_constraints(models, {"quantization": "q4"})]
        == ["a/one"],
        "quantization constraint honoured",
    )
    check(
        len(main._apply_task_constraints(models, {"quantization": "q99"})) == 3,
        "a quantization nobody publishes does not silently empty the list",
    )
    check(
        main._apply_task_constraints(models, {}) is models,
        "no constraints is a no-op",
    )


def test_vision_sibling_expansion():
    print("\n== vision sibling expansion ==")

    check(
        set(main.expand_vision_siblings(["object-detection", "text-generation"]))
        == {"object-detection", "image-classification", "text-generation"},
        "adding the vision sibling does not drop a simultaneous chat task",
    )
    check(
        main.expand_vision_siblings(["text-generation"]) == ["text-generation"],
        "a non-vision plan is untouched",
    )


# ---------------------------------------------------------------------------
# Section 11: model descriptions
# ---------------------------------------------------------------------------

class _FakeResponse:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text
        self.headers = {}

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class _FakeClient:
    """Stands in for httpx.AsyncClient. No network, fully deterministic."""

    def __init__(self, meta=None, readme=None):
        self._meta = meta
        self._readme = readme

    async def get(self, url, **kwargs):
        if url.endswith("README.md"):
            if self._readme is None:
                return _FakeResponse(404)
            return _FakeResponse(200, text=self._readme)
        if self._meta is None:
            return _FakeResponse(404)
        return _FakeResponse(200, payload=self._meta)


class _FakePool:
    """Description caching is an optimisation; these tests run without a DB."""

    class _Conn:
        async def fetch(self, *a, **k):
            return []

        async def executemany(self, *a, **k):
            return None

        async def execute(self, *a, **k):
            return None

    class _Acquire:
        async def __aenter__(self):
            return _FakePool._Conn()

        async def __aexit__(self, *a):
            return False

    def acquire(self):
        return _FakePool._Acquire()


def test_descriptions():
    print("\n== model descriptions (section 11) ==")

    device = {"phone_model": "Redmi Note 8 Pro", "ram_mb": 5636}
    max_size_mb = 5636 * 0.4

    models = [
        {"id": "google/mobilenet_v2", "name": "mobilenet_v2", "size_mb": 14.0,
         "task": "image-classification", "filename": "model.tflite",
         "format": "tflite", "reputable": True, "downloads": 900},
        {"id": "unsloth/Qwen2.5-0.5B-GGUF", "name": "Qwen2.5-0.5B", "size_mb": 400.0,
         "task": "text-generation", "filename": "q4_k_m.gguf",
         "format": "gguf", "reputable": True, "downloads": 500},
        {"id": "someone/yamnet", "name": "yamnet", "size_mb": 4.0,
         "task": "audio-classification", "filename": "yamnet.tflite",
         "format": "tflite", "reputable": False, "downloads": 10},
    ]

    async def run():
        # No metadata and no model card: the conservative fallback path.
        await main._describe_models(
            _FakePool(), _FakeClient(), models, device, max_size_mb
        )

    asyncio.run(run())

    required = ["model_id", "display_name", "capability", "description",
                "why_recommended", "format", "size_mb", "estimated_device_fit",
                "source", "source_url"]
    for model in models:
        for field in required:
            check(field in model,
                  f"{model['id']} has {field}", f"model={model}")
        check(
            bool((model.get("description") or "").strip()),
            f"{model['id']} description is non-empty",
        )
        check(
            bool((model.get("why_recommended") or "").strip()),
            f"{model['id']} why_recommended is non-empty",
        )

    descriptions = [m["description"] for m in models]
    check(
        len(set(descriptions)) == len(descriptions),
        "descriptions are not identical boilerplate across models",
        f"{descriptions}",
    )
    vision_words = ("camera", "photo", "image", "frame", "sees")
    check(
        any(w in models[0]["description"].lower() for w in vision_words),
        "the vision model's description describes vision",
        models[0]["description"],
    )
    chat_words = ("chat", "message", "reply", "text")
    check(
        any(w in models[1]["description"].lower() for w in chat_words),
        "the chat model's description describes chat",
        models[1]["description"],
    )
    check(
        models[2]["source"] == "fallback"
        and "publisher supplied no model card" in models[2]["description"],
        "the fallback is clearly marked as such rather than invented",
        models[2]["description"],
    )
    check(
        "Redmi Note 8 Pro" in models[0]["why_recommended"],
        "why_recommended names the actual device",
        models[0]["why_recommended"],
    )
    # 14 MB and 400 MB against a 2254 MB budget are both genuinely comfortable;
    # the thresholds themselves are checked directly below.
    check(
        models[0]["estimated_device_fit"] == "comfortable"
        and models[1]["estimated_device_fit"] == "comfortable",
        "device fit reflects the measured size against the real budget",
        f"{models[0]['estimated_device_fit']} / {models[1]['estimated_device_fit']}",
    )
    check(
        (main._device_fit(100, 1000), main._device_fit(600, 1000),
         main._device_fit(900, 1000), main._device_fit(1200, 1000),
         main._device_fit(None, 1000))
        == ("comfortable", "good", "tight", "over budget", "unknown"),
        "device-fit thresholds are measured, not guessed",
        str((main._device_fit(100, 1000), main._device_fit(600, 1000),
             main._device_fit(900, 1000), main._device_fit(1200, 1000))),
    )
    check(
        models[0]["source_url"] == "https://huggingface.co/google/mobilenet_v2",
        "source_url points at the real repository",
        models[0]["source_url"],
    )


def test_description_from_model_card():
    print("\n== descriptions prefer real model-card metadata ==")

    device = {"phone_model": "SM-S916W", "ram_mb": 7072}
    models = [{
        "id": "google/mobilenet_v3", "name": "mobilenet_v3", "size_mb": 10.0,
        "task": "image-classification", "filename": "m.tflite",
        "format": "tflite", "reputable": True, "downloads": 5,
    }]
    readme = (
        "---\nlicense: apache-2.0\ntags:\n- vision\n---\n\n"
        "# MobileNet V3\n\n"
        "MobileNetV3 is a lightweight convolutional network tuned for mobile "
        "CPUs, trained on ImageNet-1k and suitable for real-time on-device "
        "classification.\n"
    )
    client = _FakeClient(
        meta={"id": "google/mobilenet_v3", "pipeline_tag": "image-classification",
              "cardData": {"license": "apache-2.0"}},
        readme=readme,
    )

    asyncio.run(main._describe_models(
        _FakePool(), client, models, device, 7072 * 0.4
    ))

    check(
        models[0]["source"] == "huggingface_model_card",
        "the model card is preferred over the task-tag fallback",
        models[0]["source"],
    )
    check(
        "MobileNetV3 is a lightweight" in models[0]["description"],
        "the card's own prose is used, not an invented summary",
        models[0]["description"],
    )
    check(
        "license" not in models[0]["description"].lower().split(".")[0],
        "YAML front matter is stripped rather than presented as prose",
        models[0]["description"],
    )


def test_split_shard_exclusion():
    print("\n== split-GGUF shards are never deployable ==")

    # The exact file that crashed the Android app in production.
    crashed = "GLM-5.2-UD-IQ4_NL-00001-of-00009.gguf"
    check(main.is_split_shard(crashed), f"{crashed} is recognised as a shard")
    check(
        main.is_split_shard("model-00003-of-00012.gguf"),
        "any -NNNNN-of-NNNNN.gguf is a shard",
    )
    check(
        not main.is_split_shard("Llama-3.2-1B-Instruct-Q8_0.gguf"),
        "an ordinary single-file model is not a shard",
    )
    check(
        not main.is_split_shard("mobilenet_v2.tflite"),
        "tflite files are unaffected",
    )
    check(
        not main.is_split_shard("model-1-of-9.gguf"),
        "the pattern requires llama.cpp's 5-digit convention, not any 'of'",
    )

    # The size gate: 8.99 MB was shard 1's size, and it sailed through the
    # device budget because nothing checked whether it was a whole model.
    check(
        not main.is_usable_chat_file(crashed, 8.99),
        "the crashed file is rejected as unusable",
    )
    check(
        not main.is_usable_chat_file("tiny-fragment.gguf", 8.99),
        "a sub-floor .gguf is rejected even with an innocent name",
    )
    check(
        main.is_usable_chat_file("Llama-3.2-1B-Instruct-Q8_0.gguf", 1259.88),
        "a real single-file chat model is accepted",
    )
    check(
        main.is_usable_chat_file("model.gguf", None),
        "an unknown size does not reject by itself",
    )
    check(
        main.MIN_CHAT_MODEL_MB >= 20,
        "the chat-model floor is meaningfully above fragment size",
    )

    # _find_deployable_file is the last gate before a file reaches a phone.
    siblings = [
        {"rfilename": "GLM-5.2-UD-IQ4_NL-00001-of-00009.gguf"},
        {"rfilename": "GLM-5.2-UD-IQ4_NL-00002-of-00009.gguf"},
    ]
    check(
        main._find_deployable_file(siblings) is None,
        "a repo of nothing but shards yields no deployable file",
    )
    check(
        main._find_deployable_file(
            siblings + [{"rfilename": "GLM-5.2-Q4_K_M.gguf"}]
        ) == "GLM-5.2-Q4_K_M.gguf",
        "the single-file sibling is chosen over the shards",
    )


def test_description_readability():
    print("\n== descriptions are readable, not markup dumps ==")

    # The real GLM-5.2 card opening that leaked into the UI verbatim.
    card = (
        "---\nlicense: mit\n---\n\n"
        "Read our How to [Run GLM-5.2 Guide!](https://unsloth.ai/docs) "
        "<div> <p style=\"margin: 0 0 0px 0;\"> <em>See "
        "<a href=\"https://unsloth.ai\">Unsloth Dynamic 2.0 GGUFs</a> for our "
        "quantization benchmarks.</em> </p> </div>\n\n"
        "GLM-5.2 is a compact instruction-tuned language model designed for "
        "efficient local inference on constrained hardware.\n"
    )
    summary = main._first_card_paragraph(card)
    check(summary is not None, "a summary is still produced")
    for bad in ("<div", "<p ", "style=", "](http", "<a href", "<em>"):
        check(bad not in (summary or ""), f"summary contains no {bad!r}")
    check(
        len(summary or "") <= 225,
        "the summary is short enough for a phone-width card",
        f"len={len(summary or '')}",
    )

    check(
        main._strip_markup("See [the docs](https://x.com) and `code`")
        == "See the docs and code",
        "links keep their text and lose their URL",
    )
    check(
        main._strip_markup("<div><p>Hello</p></div>") == "Hello",
        "HTML tags are removed",
    )

    # Two chat models must not open with the same two boilerplate sentences.
    a = main._compose_description(
        {}, "text-generation", "Qwen2.5 is a small instruction-tuned model.",
        None, "huggingface_model_card")
    b = main._compose_description(
        {}, "text-generation", "Llama 3.2 1B is tuned for dialogue.",
        None, "huggingface_model_card")
    check(a != b, "two chat models get genuinely different descriptions")
    check(
        len(a) < 160 and len(b) < 160,
        "a described model gets a short card, not a paragraph of template",
        f"{len(a)} / {len(b)}",
    )
    check(
        a.startswith("Offline chat."),
        "the capability clause is one short phrase, not a full paragraph",
        a,
    )


def test_no_repeated_model_lines():
    print("\n== the selector cannot pad by repeating one model ==")

    # The exact shape produced in production with a single candidate.
    padded = (
        "I recommend the following models for a small chat model:\n"
        "1. hugging-quants/Llama-3.2-1B-Instruct-Q8_0-GGUF - 1259.88 MB - "
        "This model generates text for on-device chat.\n"
        "2. hugging-quants/Llama-3.2-1B-Instruct-Q8_0-GGUF - 1259.88 MB - "
        "This model generates text for on-device chat.\n"
        "3. hugging-quants/Llama-3.2-1B-Instruct-Q8_0-GGUF - 1259.88 MB - "
        "This model generates text for on-device chat.\n"
    )
    cleaned = main._drop_repeated_model_lines(padded)
    check(
        cleaned.count("hugging-quants/Llama-3.2-1B-Instruct-Q8_0-GGUF") == 1,
        "a model repeated as items 1-3 is listed once",
        cleaned,
    )
    check("2." not in cleaned, "the duplicate numbering is gone", cleaned)

    genuine = (
        "Here are three options:\n"
        "1. org/alpha - 400 MB - fits comfortably.\n"
        "2. org/beta - 800 MB - more capable.\n"
        "3. org/gamma - 1200 MB - best quality.\n"
    )
    kept = main._drop_repeated_model_lines(genuine)
    for repo in ("org/alpha", "org/beta", "org/gamma"):
        check(repo in kept, f"three genuinely distinct models keep {repo}")

    check(
        main._drop_repeated_model_lines("Just prose, no list.")
        == "Just prose, no list.",
        "plain prose is untouched",
    )
    check(main._drop_repeated_model_lines("") == "", "empty prose is safe")


def test_options_and_cache_versioning():
    print("\n== alternatives and cache invalidation ==")

    check(
        main.MIN_OPTIONS_PER_CAPABILITY >= 3,
        "at least three alternatives are surfaced per capability",
        str(main.MIN_OPTIONS_PER_CAPABILITY),
    )
    # "a small chat model" is quantity 1, but the user still needs a choice.
    plan = main.classify_task_plan("i want a small chat model")
    quantity = plan[0]["quantity"]
    check(quantity == 1, "the parsed deploy count is still 1", str(quantity))
    check(
        max(quantity, main.MIN_OPTIONS_PER_CAPABILITY) >= 3,
        "but at least 3 options are shown for it",
    )
    check(
        main.DESCRIPTION_SCHEMA_VERSION >= 2,
        "the description cache is versioned so old rows are rewritten",
        str(main.DESCRIPTION_SCHEMA_VERSION),
    )


def test_conversational_path_cannot_invent_models():
    print("\n== the free-form path must not name models ==")

    prompt = main._assistant_system_prompt()
    check(
        "NEVER NAME A SPECIFIC MODEL" in prompt,
        "the conversational prompt forbids naming a model outright",
    )
    check(
        "NEVER STATE A SIZE" in prompt,
        "the conversational prompt forbids stating sizes",
    )

    # "small chat models" previously fell through to free-form prose, which
    # answered with invented DistilBERT / T5-Small entries.
    for message in ("small chat models", "small model for chat",
                    "i need a chat model", "show me camera models"):
        plan = main.classify_task_plan(message)
        check(
            bool(plan) and plan[0]["capability"] in main.VALID_TASKS,
            f"the keyword planner rescues {message!r} into a real search",
            f"plan={plan}",
        )
    check(
        "text-generation" in
        [t["capability"] for t in main.classify_task_plan("small chat models")],
        "'small chat models' maps to text-generation, not small talk",
    )


def test_card_paragraph_extraction():
    print("\n== model-card prose extraction ==")

    check(
        main._first_card_paragraph("") is None,
        "an empty card yields no summary rather than an empty string",
    )
    check(
        main._first_card_paragraph("# Title\n\n![badge](x)\n\n| a | b |\n") is None,
        "badges and tables are not mistaken for a description",
    )
    long_card = "---\nlicense: mit\n---\n\n" + ("word " * 200)
    summary = main._first_card_paragraph(long_card)
    check(summary is not None and len(summary) <= 405,
          "a long card is truncated to a concise summary", str(summary)[:60])


# ---------------------------------------------------------------------------
# Section 9: run lifecycle helpers
# ---------------------------------------------------------------------------

def test_run_lifecycle_helpers():
    print("\n== run lifecycle (section 9) ==")

    key_a = main._conversation_lock_key("11111111-1111-1111-1111-111111111111")
    key_b = main._conversation_lock_key("22222222-2222-2222-2222-222222222222")
    check(key_a == main._conversation_lock_key("11111111-1111-1111-1111-111111111111"),
          "the advisory lock key is stable for one conversation")
    check(key_a != key_b, "different conversations get different lock keys")
    check(
        -(2 ** 63) <= key_a < 2 ** 63,
        "the lock key fits Postgres' bigint, so pg_advisory_lock accepts it",
    )
    check(
        main.RUN_TERMINAL_STATUSES == {"completed", "failed", "cancelled"}
        and main.RUN_ACTIVE_STATUSES == {"queued", "routing", "generating"},
        "the six required run statuses are defined and partitioned",
    )
    check(
        main.CHAT_TURN_DEADLINE_SECONDS > 0,
        "a chat turn has a hard end-to-end deadline",
    )


def test_greeting_path_is_bounded():
    print("\n== greeting latency (section 8) ==")

    check(
        main.NIM_GREETING_MODEL == main.NIM_INTENT_MODEL,
        "greetings default to the small fast model, not the 70b router",
        main.NIM_GREETING_MODEL,
    )
    check(
        main.GREETING_DEADLINE_SECONDS <= 10,
        "the greeting deadline is short enough to feel instant",
        str(main.GREETING_DEADLINE_SECONDS),
    )
    check(
        bool(main._DETERMINISTIC_GREETING.strip()),
        "a deterministic reply exists so a provider failure still terminates",
    )


def test_email_delivery_path_reporting():
    print("\n== feedback delivery diagnostics (section 13) ==")

    path = main.email_delivery_path()
    check(
        path in ("relay", "smtp", "unconfigured"),
        "the configured delivery path is reportable",
        path,
    )
    check(
        main._feedback_error_code(RuntimeError("535 auth failed"))
        == "SMTP_AUTH_REJECTED",
        "auth rejection is classified as permanent",
    )
    check(
        main._feedback_error_code(RuntimeError("connection timeout"))
        == "SMTP_TIMEOUT",
        "a timeout is classified as retryable",
    )


if __name__ == "__main__":
    test_multi_intent_prompts()
    test_quantities_and_order()
    test_plan_schema_validation()
    test_constraint_filtering()
    test_vision_sibling_expansion()
    test_descriptions()
    test_description_from_model_card()
    test_split_shard_exclusion()
    test_description_readability()
    test_no_repeated_model_lines()
    test_options_and_cache_versioning()
    test_conversational_path_cannot_invent_models()
    test_card_paragraph_extraction()
    test_run_lifecycle_helpers()
    test_greeting_path_is_bounded()
    test_email_delivery_path_reporting()

    print(f"\n{CHECKS - len(FAILURES)}/{CHECKS} checks passed")
    if FAILURES:
        print("FAILED:")
        for name in FAILURES:
            print(f"  - {name}")
        sys.exit(1)
    print("ALL PASSED")
