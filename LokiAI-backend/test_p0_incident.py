"""P0 incident regression tests.

Covers the three confirmed failures from the incident review:

  1. An audio artifact bound to tflite_yamnet_audio_v1 by nothing more than
     the substring "yamnet" in its filename, plus a .tflite extension and an
     audio-classification pipeline tag. The artifact declared a 1-sample
     input window against a 15600-sample adapter contract.
  2. SERVICE_DISCONNECTED (an Android service fault) reported as a model
     failure code with redeploy advice.
  3. Cancelled deployments recording no actor, source, time or correlation.

Plus release-identity coverage, because "the commit matched" was previously
inferred from file size rather than proven.

Run:  python -m unittest test_p0_incident -v
"""

import os
import unittest

os.environ.setdefault("SKIP_DB", "1")

import main


# ---------------------------------------------------------------------------
# 1-11: audio adapter binding
# ---------------------------------------------------------------------------
class AudioBindingTests(unittest.TestCase):
    """The exact artifact from the incident, plus every signal that must NOT
    be sufficient to bind an adapter."""

    INCIDENT_FILENAME = "yamnetp_ahead_ds_lr0.000001.tflite"

    def setUp(self):
        self._catalog = list(main.AUDIO_ARTIFACT_CATALOG)
        self._flag = main.AUDIO_MODEL_DEPLOYMENT_ENABLED

    def tearDown(self):
        main.AUDIO_ARTIFACT_CATALOG[:] = self._catalog
        main.AUDIO_MODEL_DEPLOYMENT_ENABLED = self._flag

    def _enable_with(self, entry):
        main.AUDIO_ARTIFACT_CATALOG[:] = [entry]
        main.AUDIO_MODEL_DEPLOYMENT_ENABLED = True

    @staticmethod
    def _entry(**overrides):
        base = {
            "repository": "verified-org/verified-yamnet",
            "revision": "a" * 40,
            "filename": "yamnet.tflite",
            "sha256": "b" * 64,
            "size_bytes": 4_185_112,
            "adapter_id": "tflite_yamnet_audio_v1",
            "adapter_version": "1",
            "task": "audio-classification",
            "input_dtype": "float32",
            "input_shape": [15600],
            "sample_rate": 16000,
            "sample_count": 15600,
            "output_shape": [521],
            "label_set_id": "audioset_v1",
            "label_count": 521,
            "preprocessing": "pcm16_mono_to_float32_16khz",
            "runtime_version_range": "tflite_flutter_0.12.x",
            "verification_status": "IMPLEMENTED_AND_TESTED",
        }
        base.update(overrides)
        return base

    # --- 1: filename substring must not bind ------------------------------
    def test_01_filename_containing_yamnet_does_not_bind(self):
        """The incident artifact itself. 'yamnetp' contains 'yamnet'."""
        result = main.bind_runtime_adapter(
            "someone/audio-experiments", self.INCIDENT_FILENAME,
            "audio-classification", 3.9,
        )
        self.assertIsNone(result.adapter)
        self.assertNotEqual(result.code, None)

    # --- 2: repository name must not bind ---------------------------------
    def test_02_repository_containing_yamnet_does_not_bind(self):
        result = main.bind_runtime_adapter(
            "yamnet-labs/whatever", "model.tflite", "audio-classification", 4.0,
        )
        self.assertIsNone(result.adapter)

    # --- 3: pipeline tag must not bind ------------------------------------
    def test_03_pipeline_tag_alone_does_not_bind(self):
        result = main.bind_runtime_adapter(
            "acme/sounds", "classifier.tflite", "audio-classification", 4.0,
        )
        self.assertIsNone(result.adapter)

    # --- 4: arbitrary float32 tflite must not bind ------------------------
    def test_04_arbitrary_float32_tflite_does_not_bind(self):
        """Float32 alone was never a compatibility contract."""
        for name in ("audio_float32.tflite", "sound_classifier_fp32.tflite",
                     "yamnet_finetuned_v2.tflite", "YAMNet.tflite"):
            with self.subTest(filename=name):
                result = main.bind_runtime_adapter(
                    "org/repo", name, "audio-classification", 4.0,
                )
                self.assertIsNone(result.adapter, f"{name} must not bind")

    # --- 5: exact catalog identity binds ----------------------------------
    def test_05_exact_catalog_artifact_binds(self):
        entry = self._entry()
        self._enable_with(entry)
        result = main.bind_runtime_adapter(
            entry["repository"], entry["filename"], "audio-classification", 4.0,
            revision=entry["revision"], sha256=entry["sha256"],
            size_bytes=entry["size_bytes"],
        )
        self.assertIsNotNone(result.adapter)
        self.assertEqual(result.adapter["adapter_id"], "tflite_yamnet_audio_v1")
        self.assertEqual(result.catalog_entry["sha256"], entry["sha256"])

    # --- 6: wrong sha256 rejected -----------------------------------------
    def test_06_wrong_sha256_is_rejected(self):
        entry = self._entry()
        self._enable_with(entry)
        result = main.bind_runtime_adapter(
            entry["repository"], entry["filename"], "audio-classification", 4.0,
            revision=entry["revision"], sha256="c" * 64,
            size_bytes=entry["size_bytes"],
        )
        self.assertIsNone(result.adapter)
        self.assertIn("SHA-256", result.detail)

    # --- 7: wrong revision rejected ---------------------------------------
    def test_07_wrong_revision_is_rejected(self):
        entry = self._entry()
        self._enable_with(entry)
        result = main.bind_runtime_adapter(
            entry["repository"], entry["filename"], "audio-classification", 4.0,
            revision="d" * 40, sha256=entry["sha256"],
            size_bytes=entry["size_bytes"],
        )
        self.assertIsNone(result.adapter)

    def test_07b_mutable_branch_is_not_an_identity(self):
        """'main' can point at different bytes tomorrow."""
        entry = self._entry()
        self._enable_with(entry)
        result = main.bind_runtime_adapter(
            entry["repository"], entry["filename"], "audio-classification", 4.0,
            revision="main", sha256=entry["sha256"],
            size_bytes=entry["size_bytes"],
        )
        self.assertIsNone(result.adapter)
        self.assertIn("immutable", result.detail.lower())

    # --- 8: wrong size rejected -------------------------------------------
    def test_08_wrong_size_is_rejected(self):
        entry = self._entry()
        self._enable_with(entry)
        result = main.bind_runtime_adapter(
            entry["repository"], entry["filename"], "audio-classification", 4.0,
            revision=entry["revision"], sha256=entry["sha256"],
            size_bytes=entry["size_bytes"] + 1,
        )
        self.assertIsNone(result.adapter)
        self.assertIn("bytes", result.detail)

    # --- 9: disabled feature blocks recommendation ------------------------
    def test_09_disabled_audio_prevents_recommendation(self):
        entry = self._entry()
        main.AUDIO_ARTIFACT_CATALOG[:] = [entry]
        main.AUDIO_MODEL_DEPLOYMENT_ENABLED = False
        compat = main.resolve_runtime_compatibility(
            entry["repository"], entry["filename"], "audio-classification", 4.0,
            {"ram_mb": 8192}, revision=entry["revision"],
            sha256=entry["sha256"], size_bytes=entry["size_bytes"],
        )
        self.assertFalse(compat["deployable"])
        self.assertEqual(compat["rejection_code"],
                         "AUDIO_DEPLOYMENT_TEMPORARILY_DISABLED")

    # --- 10: disabled feature blocks deployment ---------------------------
    def test_10_disabled_audio_prevents_direct_deployment(self):
        """The gate POST /deployments applies before the resolver runs."""
        main.AUDIO_MODEL_DEPLOYMENT_ENABLED = False
        self.assertFalse(main.audio_deployment_enabled())
        self.assertIn("audio-classification", main.AUDIO_TASKS)

    def test_10b_empty_catalog_cannot_be_enabled(self):
        """Flipping the env var alone must not enable a path with nothing
        proven to deploy."""
        main.AUDIO_ARTIFACT_CATALOG[:] = []
        main.AUDIO_MODEL_DEPLOYMENT_ENABLED = True
        self.assertFalse(main.audio_deployment_enabled())

    def test_10c_shipped_catalog_is_empty_and_audio_is_off(self):
        """The shipped default. Guards against someone adding an unverified
        entry to make tests pass."""
        self.assertEqual(len(self._catalog), 0)
        self.assertFalse(main.audio_deployment_enabled())

    # --- 11: precise error, never "device incompatible" -------------------
    def test_11_unsupported_audio_artifact_returns_precise_error(self):
        compat = main.resolve_runtime_compatibility(
            "someone/audio-experiments", self.INCIDENT_FILENAME,
            "audio-classification", 3.9, {"ram_mb": 8192},
        )
        self.assertFalse(compat["deployable"])
        self.assertIsNotNone(compat["rejection_detail"])
        message = (compat["rejection_detail"] or "").lower()
        # Must not send the user hunting for a "standard Float32" model —
        # that advice is what caused this incident — and must not present a
        # LokiAI-side restriction as a device limitation.
        self.assertNotIn("standard float32", message)
        self.assertNotIn("your device does not", message)
        self.assertNotIn("not supported by your phone", message)

    def test_11b_disabled_message_is_functional_not_device_incompatibility(self):
        message = main.AUDIO_DISABLED_MESSAGE.lower()
        self.assertIn("temporarily unavailable", message)
        self.assertNotIn("standard float32", message)
        self.assertIn("not a limitation of your phone", message)

    # --- resolver contract -------------------------------------------------
    def test_resolver_returns_full_contract_fields(self):
        entry = self._entry()
        self._enable_with(entry)
        compat = main.resolve_runtime_compatibility(
            entry["repository"], entry["filename"], "audio-classification", 4.0,
            {"ram_mb": 8192}, revision=entry["revision"],
            sha256=entry["sha256"], size_bytes=entry["size_bytes"],
        )
        for field in ("deployable", "adapter_id", "adapter_version",
                      "artifact_manifest", "expected_sha256", "expected_size",
                      "runtime_contract", "verification_level",
                      "rejection_code", "rejection_detail"):
            self.assertIn(field, compat)
        self.assertEqual(compat["expected_sha256"], entry["sha256"])
        self.assertEqual(compat["expected_size"], entry["size_bytes"])
        self.assertEqual(compat["runtime_contract"]["sample_count"], 15600)
        self.assertEqual(compat["verification_level"],
                         "catalog_verified_artifact")
        # The phone remains the final authority regardless of catalog status.
        self.assertFalse(compat["runtime_verified"])

    def test_chat_binding_still_works(self):
        """The audio fix must not regress chat deployment."""
        result = main.bind_runtime_adapter(
            "bartowski/Llama-3.2-1B-Instruct-GGUF",
            "Llama-3.2-1B-Instruct-Q4_K_M.gguf", "text-generation", 800.0,
        )
        self.assertIsNotNone(result.adapter)
        self.assertEqual(result.adapter["adapter_id"], "llama_cpp_gguf_chat_v1")


# ---------------------------------------------------------------------------
# 12-19: service failure classification
# ---------------------------------------------------------------------------
class ServiceClassificationTests(unittest.TestCase):

    def test_12_service_codes_are_not_model_codes(self):
        """SERVICE_DISCONNECTED must never be CHAT_CONTEXT_CREATE_FAILED."""
        self.assertNotIn("CHAT_CONTEXT_CREATE_FAILED",
                         main.INFERENCE_SERVICE_FAILURE_CODES)
        self.assertTrue(main.is_service_failure("INFERENCE_SERVICE_DISCONNECTED"))
        self.assertFalse(main.is_service_failure("CHAT_CONTEXT_CREATE_FAILED"))

    def test_12b_all_ten_codes_exist_with_messages(self):
        expected = {
            "INFERENCE_SERVICE_DISCONNECTED", "INFERENCE_SERVICE_BIND_FAILED",
            "INFERENCE_SERVICE_DIED", "INFERENCE_SERVICE_BINDER_DIED",
            "INFERENCE_SERVICE_START_FAILED",
            "INFERENCE_SERVICE_REBIND_EXHAUSTED",
            "INFERENCE_SERVICE_LOW_MEMORY_KILL",
            "INFERENCE_SERVICE_NATIVE_CRASH", "INFERENCE_SERVICE_JVM_CRASH",
            "INFERENCE_SERVICE_UNKNOWN_EXIT",
        }
        self.assertEqual(expected, set(main.INFERENCE_SERVICE_FAILURE_CODES))
        for code in expected:
            self.assertIn(code, main.ERROR_CODE_EXPLANATIONS)

    def test_13_service_messages_never_suggest_redeploy(self):
        """Redeploying identical bytes cannot fix a dead service."""
        for code in main.INFERENCE_SERVICE_FAILURE_CODES:
            message = main.ERROR_CODE_EXPLANATIONS[code].lower()
            with self.subTest(code=code):
                self.assertNotIn("redeploy", message)
                self.assertNotIn("incompatible model", message)

    def test_18_unknown_exit_is_not_described_as_memory(self):
        """An unexplained exit must stay unexplained, never become 'OOM'."""
        message = main.ERROR_CODE_EXPLANATIONS[
            "INFERENCE_SERVICE_UNKNOWN_EXIT"].lower()
        self.assertNotIn("memory", message)
        self.assertIn("does not report", message)


# ---------------------------------------------------------------------------
# 20-27: cancellation attribution
# ---------------------------------------------------------------------------
class CancellationTests(unittest.TestCase):
    """The schema/enum surface. End-to-end attribution requires a database
    and is covered by the device validation script, not fabricated here."""

    SOURCES = {
        "user_dashboard", "user_api", "device", "superseded",
        "backend_recovery", "administrator", "unknown_legacy",
    }

    def _migration(self, suffix):
        path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "migrations",
            f"20260806_deployment_cancellation_audit_{suffix}.sql",
        )
        with open(path, encoding="utf-8") as fh:
            return fh.read()

    def test_20_26_migration_adds_every_attribution_column(self):
        sql = self._migration("forward")
        for column in ("cancellation_source", "cancelled_by_user_id",
                       "cancelled_by_device_id", "cancelled_at",
                       "cancellation_request_id", "cancellation_reason",
                       "superseded_by_deployment_id",
                       "progress_at_cancellation"):
            with self.subTest(column=column):
                self.assertIn(column, sql)

    def test_20_26_all_sources_allowed(self):
        sql = self._migration("forward")
        for source in self.SOURCES:
            with self.subTest(source=source):
                self.assertIn(f"'{source}'", sql)

    def test_26_legacy_rows_map_to_unknown_legacy(self):
        sql = self._migration("forward")
        self.assertIn("unknown_legacy", sql)
        self.assertIn("UPDATE deployments", sql)
        self.assertIn("WHERE status = 'cancelled'", sql)

    def test_rollback_drops_every_added_column(self):
        forward = self._migration("forward")
        rollback = self._migration("rollback")
        for column in ("cancellation_source", "cancelled_by_user_id",
                       "cancelled_by_device_id", "cancelled_at",
                       "cancellation_request_id", "cancellation_reason",
                       "superseded_by_deployment_id",
                       "progress_at_cancellation"):
            with self.subTest(column=column):
                self.assertIn(f"DROP COLUMN IF EXISTS {column}", rollback)
                self.assertIn(column, forward)

    def test_22_cancel_endpoint_preserves_progress(self):
        """`progress` must not be zeroed; it is copied, not replaced."""
        import inspect
        source = inspect.getsource(main.cancel_deployment)
        self.assertIn("progress_at_cancellation = progress", source)
        self.assertNotIn("SET status = 'cancelled', progress = 0", source)

    def test_20_21_cancel_endpoint_records_actor_and_source(self):
        import inspect
        source = inspect.getsource(main.cancel_deployment)
        self.assertIn("cancelled_by_user_id", source)
        self.assertIn("user_dashboard", source)
        self.assertIn("user_api", source)

    def test_23_duplicate_cancellation_is_idempotent(self):
        import inspect
        source = inspect.getsource(main.cancel_deployment)
        self.assertIn("idempotent_replay", source)

    def test_24_cancel_command_carries_correlation_id(self):
        import inspect
        source = inspect.getsource(main.cancel_deployment)
        self.assertIn("cancellation_request_id", source)
        self.assertIn("x-lokiai-request-id", source)

    def test_25_supersede_records_successor(self):
        import inspect
        source = inspect.getsource(main.create_deployment)
        self.assertIn("superseded_by_deployment_id", source)
        self.assertIn("'superseded'", source)

    def test_27_device_ack_is_recorded_as_acknowledgement(self):
        import inspect
        source = inspect.getsource(main._handle_deployment_update)
        # The phone's cancelled report must not fall into the 'failed' branch.
        self.assertIn('elif status == "cancelled":', source)
        self.assertIn("COALESCE(cancellation_source, 'device')", source)


# ---------------------------------------------------------------------------
# 28-31: release identity
# ---------------------------------------------------------------------------
class ReleaseIdentityTests(unittest.TestCase):

    def test_28_apk_info_returns_sha256_and_versions(self):
        if not os.path.exists(main._APK_PATH):
            self.skipTest("No APK present in this checkout")
        info = main._apk_identity()
        for field in ("application_id", "version_name", "version_code",
                      "sha256", "size_bytes", "published_by_commit",
                      "build_timestamp", "runtime_protocol_version",
                      "supported_adapter_versions"):
            with self.subTest(field=field):
                self.assertIn(field, info)
        self.assertEqual(len(info["sha256"]), 64)
        self.assertGreater(info["size_bytes"], 0)

    def test_29_health_returns_protocol_information(self):
        health = main.health_check()
        for field in ("commit", "backend_protocol_version",
                      "runtime_protocol_version", "adapter_version",
                      "supported_adapter_ids", "audio_deployment_enabled"):
            with self.subTest(field=field):
                self.assertIn(field, health)

    def test_30_state_report_stores_mobile_build_identity(self):
        import inspect
        source = inspect.getsource(main._handle_state_report)
        self.assertIn("device_build_identity", source)
        self.assertIn("protocol_version", source)
        self.assertIn("version_name", source)

    def test_31_diagnostics_exposes_version_mismatch(self):
        import inspect
        source = inspect.getsource(main.diagnostics_versions)
        for token in ("mismatches", "unverifiable", "consistent",
                      "dashboard", "apk", "devices"):
            with self.subTest(token=token):
                self.assertIn(token, source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
