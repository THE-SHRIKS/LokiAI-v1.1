"""Tests for the AI recommendation/troubleshooting behavior system
(lokiai_ai_responses_prompt.md). Covers the deterministic constraint parser,
capability ontology/disambiguation, repetition-prevention state, ranking
evidence, and troubleshooting routing/error mapping — the parts that are
pure functions and don't require a live database or NIM provider.
"""
import os
import unittest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-for-ai-response-system")
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost/db")

import main


class ConstraintParserTests(unittest.TestCase):
    """Part 2: deterministic numeric constraint parsing."""

    def test_greater_than_gb_sets_min_size(self):
        c = main.extract_hard_constraints("find chat models greater than 2 GB")
        self.assertEqual(c["min_size_mb"], 2048)
        self.assertNotIn("max_size_mb", c)

    def test_under_mb_sets_max_size(self):
        c = main.extract_hard_constraints("something under 500 MB")
        self.assertEqual(c["max_size_mb"], 500)
        self.assertNotIn("min_size_mb", c)

    def test_at_least_kb_converts_to_mb(self):
        c = main.extract_hard_constraints("at least 512 KB please")
        self.assertAlmostEqual(c["min_size_mb"], 0.5)

    def test_between_size_sets_both_bounds(self):
        c = main.extract_hard_constraints("a model between 1 GB and 2 GB")
        self.assertEqual(c["min_size_mb"], 1024)
        self.assertEqual(c["max_size_mb"], 2048)

    def test_bare_7b_sets_exact_parameter(self):
        c = main.extract_hard_constraints("I want a 7B model")
        self.assertEqual(c["parameter_b"], 7)
        self.assertNotIn("min_parameter_b", c)

    def test_at_least_billion_sets_min_parameter(self):
        c = main.extract_hard_constraints("at least 3 billion parameters")
        self.assertEqual(c["min_parameter_b"], 3)

    def test_under_b_sets_max_parameter(self):
        c = main.extract_hard_constraints("under 2b parameters")
        self.assertEqual(c["max_parameter_b"], 2)

    def test_between_parameters_sets_both_bounds(self):
        c = main.extract_hard_constraints("between 3B and 8B")
        self.assertEqual(c["min_parameter_b"], 3)
        self.assertEqual(c["max_parameter_b"], 8)

    def test_million_parameter_converts_to_billion_scale(self):
        c = main.extract_hard_constraints("a 500 million parameter model")
        self.assertAlmostEqual(c["parameter_b"], 0.5)

    def test_no_constraint_in_plain_message(self):
        self.assertEqual(main.extract_hard_constraints("find me a chat model"), {})


class ParameterRangeFilterTests(unittest.TestCase):
    """Part 2/5: hard constraints must be enforced against every candidate,
    never silently dropped when the parameter count can't be verified."""

    def test_within_range_passes(self):
        self.assertTrue(main._filename_matches_parameter_range(
            "model-q4_k_m.gguf", "Qwen/Qwen2.5-7B-Instruct-GGUF", 3.0, 8.0
        ))

    def test_outside_range_is_excluded(self):
        self.assertFalse(main._filename_matches_parameter_range(
            "model-q4_k_m.gguf", "Qwen/Qwen2.5-1B-Instruct-GGUF", 3.0, 8.0
        ))

    def test_unverifiable_parameter_count_is_excluded_not_assumed(self):
        # No parseable "NB" token anywhere in id/filename — must not pass a
        # hard constraint just because it couldn't be checked.
        self.assertFalse(main._filename_matches_parameter_range(
            "model.gguf", "someorg/some-chat-model", 3.0, 8.0
        ))

    def test_no_bounds_always_passes(self):
        self.assertTrue(main._filename_matches_parameter_range(
            "anything.gguf", "someorg/anything", None, None
        ))


class DescribeHardConstraintsTests(unittest.TestCase):
    """Part 2: 'say so directly' rather than silently returning the closest
    model or a generic budget line."""

    def test_describes_min_size(self):
        text = main.describe_hard_constraints({"min_size_mb": 2048})
        self.assertIn("2.0 GB", text)

    def test_describes_exact_parameter(self):
        text = main.describe_hard_constraints({"parameter_b": 7})
        self.assertIn("7B parameters specifically", text)

    def test_empty_constraints_is_empty_string(self):
        self.assertEqual(main.describe_hard_constraints({}), "")


class CapabilityOntologyTests(unittest.TestCase):
    """Part 4: keyword-spotting and voice-activity-detection are distinct
    from audio-classification and automatic-speech-recognition, and a bare
    'voice model' request must not silently guess between the four."""

    def test_new_capabilities_are_valid_tasks(self):
        self.assertIn("keyword-spotting", main.VALID_TASKS)
        self.assertIn("voice-activity-detection", main.VALID_TASKS)

    def test_new_capabilities_are_not_runtime_supported(self):
        # No implemented Android adapter exists for these yet — they must not
        # be silently satisfied by a general audio-classification model.
        self.assertNotIn("keyword-spotting", main.RUNTIME_SUPPORTED_TASKS)
        self.assertNotIn("voice-activity-detection", main.RUNTIME_SUPPORTED_TASKS)

    def test_generic_voice_model_needs_clarification(self):
        self.assertTrue(main.voice_request_needs_clarification("I want a voice model"))
        self.assertTrue(main.voice_request_needs_clarification("give me a sound model"))

    def test_specific_wake_word_request_is_not_ambiguous(self):
        self.assertFalse(main.voice_request_needs_clarification(
            "I want a wake word detection model"
        ))

    def test_specific_transcription_request_is_not_ambiguous(self):
        self.assertFalse(main.voice_request_needs_clarification(
            "I want a voice model that can transcribe speech to text"
        ))

    def test_environmental_sound_request_is_not_ambiguous(self):
        self.assertFalse(main.voice_request_needs_clarification(
            "I want a sound model that can classify environmental sounds"
        ))

    def test_message_without_generic_voice_term_is_not_ambiguous(self):
        self.assertFalse(main.voice_request_needs_clarification("find me a chat model"))


class TroubleshootingRoutingTests(unittest.TestCase):
    """Part 9: failure reports must route to troubleshooting, not search —
    including phrasings that previously fell through undetected."""

    def test_microphone_does_nothing(self):
        self.assertEqual(
            main.detect_troubleshooting_intent("the microphone does nothing"),
            "microphone",
        )

    def test_camera_crashed(self):
        self.assertEqual(
            main.detect_troubleshooting_intent("camera crashed after I changed models"),
            "camera",
        )

    def test_deployed_but_did_not_run(self):
        self.assertEqual(
            main.detect_troubleshooting_intent("the model deployed but did not run"),
            "deployment",
        )

    def test_sound_model_gave_an_error(self):
        # Previously fell through: neither "mic"/"microphone" nor the old
        # narrower failure-word list matched this real reported phrasing.
        self.assertEqual(
            main.detect_troubleshooting_intent("the sound model gave an error"),
            "microphone",
        )

    def test_chat_loaded_but_does_not_answer(self):
        # Previously fell through: only the contraction "doesn't" matched,
        # not the uncontracted "does not".
        self.assertEqual(
            main.detect_troubleshooting_intent("the chat model loaded but does not answer"),
            "chat",
        )

    def test_plain_search_request_is_not_troubleshooting(self):
        self.assertIsNone(
            main.detect_troubleshooting_intent("find me a fast chat model")
        )

    def test_troubleshooting_precedes_search_keywords(self):
        self.assertEqual(
            main.detect_troubleshooting_intent(
                "the microphone does nothing, find another sound model"
            ),
            "microphone",
        )


class ErrorCodeMappingTests(unittest.TestCase):
    """Part 10: deterministic error-code -> explanation mapping, used as a
    fallback when the phone's own error_detail is thin or missing."""

    def test_known_codes_have_explanations(self):
        for code in (
            "MODEL_BUNDLE_INCOMPLETE", "AUDIO_TENSOR_CONTRACT_MISMATCH",
            "CAMERA_ALREADY_IN_USE", "CHAT_CONTEXT_CREATE_FAILED",
            "VISION_OUTPUT_CONTRACT_MISMATCH", "MODEL_NATIVE_PROCESS_DIED",
        ):
            self.assertIn(code, main.ERROR_CODE_EXPLANATIONS)
            self.assertTrue(main.ERROR_CODE_EXPLANATIONS[code])

    def test_explanations_do_not_claim_whole_device_incompatibility(self):
        for text in main.ERROR_CODE_EXPLANATIONS.values():
            self.assertNotIn("phone is incompatible", text.lower())
            self.assertNotIn("device is incompatible", text.lower())


class ConversationStateTests(unittest.TestCase):
    """Part 3/6: structured, explicit conversation state — task changes
    clear obsolete constraints/exclusions; repetition state persists."""

    def test_task_change_clears_shown_and_constraints(self):
        state = {
            "active_capability": "object-detection",
            "hard_constraints": {"max_size_mb": 100},
            "shown_candidate_ids": ["a/b", "c/d"],
            "failed_candidate_keys": ["x/y"],
            "deployed_candidate_ids": ["z/w"],
        }
        new_state = main._apply_task_change_to_state(state, "text-generation")
        self.assertEqual(new_state["active_capability"], "text-generation")
        self.assertEqual(new_state["shown_candidate_ids"], [])
        self.assertEqual(new_state["hard_constraints"], {})
        # Cross-task memory survives the switch.
        self.assertEqual(new_state["failed_candidate_keys"], ["x/y"])
        self.assertEqual(new_state["deployed_candidate_ids"], ["z/w"])

    def test_same_capability_preserves_state(self):
        state = {"active_capability": "text-generation", "shown_candidate_ids": ["a/b"]}
        new_state = main._apply_task_change_to_state(state, "text-generation")
        self.assertEqual(new_state["shown_candidate_ids"], ["a/b"])

    def test_record_shown_candidates_dedupes(self):
        state = {"shown_candidate_ids": ["a/b"]}
        state = main._record_shown_candidates(state, ["a/b", "c/d"])
        self.assertEqual(state["shown_candidate_ids"], ["a/b", "c/d"])

    def test_record_shown_candidates_caps_length(self):
        state = {"shown_candidate_ids": [f"m/{i}" for i in range(main._MAX_TRACKED_CANDIDATE_IDS)]}
        state = main._record_shown_candidates(state, ["m/new"])
        self.assertLessEqual(len(state["shown_candidate_ids"]), main._MAX_TRACKED_CANDIDATE_IDS)
        self.assertIn("m/new", state["shown_candidate_ids"])

    def test_retry_requested_detection(self):
        self.assertTrue(main.is_retry_requested("please retry the failed model"))
        self.assertTrue(main.is_retry_requested("try that again"))
        self.assertFalse(main.is_retry_requested("find me a different model"))


class RankingEvidenceTests(unittest.TestCase):
    """Part 7: ranking is deterministic and produces structured evidence;
    NIM may explain it but does not create it."""

    def test_attach_ranking_evidence_orders_and_annotates(self):
        models = [
            {"id": "a/1", "adapter_id": "llama_cpp_gguf_chat_v1", "reputable": True},
            {"id": "b/2", "adapter_id": "llama_cpp_gguf_chat_v1", "reputable": False},
        ]
        main.attach_ranking_evidence(models, "any")
        self.assertEqual(models[0]["rank"], 1)
        self.assertEqual(models[1]["rank"], 2)
        self.assertIn("Runtime adapter llama_cpp_gguf_chat_v1 implemented and tested",
                       models[0]["ranking_reasons"])

    def test_previously_failed_candidate_is_flagged_in_reasons(self):
        models = [{"id": "a/1", "previously_failed_on_device": True}]
        main.attach_ranking_evidence(models, "any")
        self.assertTrue(any("Previously failed on this device" in r
                             for r in models[0]["ranking_reasons"]))


if __name__ == "__main__":
    unittest.main()
