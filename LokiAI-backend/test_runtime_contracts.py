import os
import unittest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-for-runtime-contracts")
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost/db")

import main


class RuntimeContractTests(unittest.TestCase):
    def test_min_size_constraint_parses_gb(self):
        constraints = main.extract_hard_constraints("find chat models greater than 2 GB")
        self.assertEqual(constraints["min_size_mb"], 2048)

    def test_parameter_constraint_parses_7b(self):
        constraints = main.extract_hard_constraints("I want a 7B model")
        self.assertEqual(constraints["parameter_b"], 7)
        self.assertTrue(
            main._filename_matches_parameter_constraint(
                "model-Q4_K_M.gguf", "Qwen/Qwen2.5-7B-Instruct-GGUF", 7.0
            )
        )
        self.assertFalse(
            main._filename_matches_parameter_constraint(
                "model-Q4_K_M.gguf", "Qwen/Qwen2.5-4B-Instruct-GGUF", 7.0
            )
        )

    def test_partially_implemented_adapter_is_not_deployable(self):
        adapter = main.bind_runtime_adapter(
            "example/yolox-tflite", "yolox.tflite", "object-detection", 25
        )
        self.assertIsNone(adapter)

    def test_unknown_adapter_rejected_by_resolver(self):
        result = main.resolve_runtime_compatibility(
            "example/panns", "cnn14.tflite", "audio-classification", 50,
            {"ram_mb": 8192},
        )
        self.assertFalse(result["deployable"])
        self.assertEqual(result["rejection_code"], "RUNTIME_ADAPTER_UNSUPPORTED")

    def test_description_is_structured_not_readme(self):
        model = {
            "id": "example/model",
            "task": "text-generation",
            "format": "gguf",
            "filename": "model-q4_k_m.gguf",
            "size_mb": 1536,
            "adapter_id": "llama_cpp_gguf_chat_v1",
            "runtime_verified": False,
            "memory_estimate": {"estimated_peak_mb": 2900},
        }
        description = main._compose_description(
            model,
            "text-generation",
            "Install llama.cpp through Homebrew before running this model.",
            None,
            "huggingface_model_card",
        )
        self.assertIn("LokiAI adapter llama_cpp_gguf_chat_v1", description)
        self.assertNotIn("Homebrew", description)

    def test_troubleshooting_precedes_search_keywords(self):
        self.assertEqual(
            main.detect_troubleshooting_intent("the microphone does nothing, find another sound model"),
            "microphone",
        )
        self.assertEqual(
            main.detect_troubleshooting_intent("camera crashed after I changed models"),
            "camera",
        )


if __name__ == "__main__":
    unittest.main()
