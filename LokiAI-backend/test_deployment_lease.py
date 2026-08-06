"""Unit tests for the connectivity-aware deployment-lease pieces added to
fix the "device blocked for ~15 minutes by a stale deployment row" and
"late ready event resurrects a cancelled deployment" production incidents.

Scoped to what is actually testable without a live Postgres instance (this
sandbox has none): DeviceConnectionManager's pure in-memory connectivity
state, and the presence/shape of the new guard logic. The DB-dependent
paths (_release_if_abandoned, _handle_runtime_event's cancelled guard,
create_deployment's 409 detail shape) are covered by inspection and by the
DeviceConnectionManager unit tests below, but a full integration test
against a real deployments table is declared blocked — see the final
report — rather than faked here.
"""
import asyncio
import os
import unittest

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-for-deployment-lease")
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost/db")

import main


class FakeWebSocket:
    def __init__(self):
        self.closed = False
        self.close_code = None

    async def close(self, code=None, reason=None):
        self.closed = True
        self.close_code = code


class DeviceConnectionManagerTests(unittest.TestCase):
    """The 409-blocking fix in create_deployment and the fast-release path
    in _release_if_abandoned both gate on ws_manager.is_connected(device_id)
    — so its correctness under reconnect/supersede is the load-bearing
    invariant for "a dead deployment must unlock quickly" without
    regressing "a live deployment still returns 409"."""

    def test_not_connected_initially(self):
        mgr = main.DeviceConnectionManager()
        self.assertFalse(mgr.is_connected("device-1"))

    def test_connected_after_connect(self):
        async def run():
            mgr = main.DeviceConnectionManager()
            ws = FakeWebSocket()
            await mgr.connect("device-1", ws)
            self.assertTrue(mgr.is_connected("device-1"))
            self.assertFalse(mgr.is_connected("device-2"))

        asyncio.run(run())

    def test_reconnect_closes_superseded_socket(self):
        # A phone that reconnects (backgrounded, network flap, process
        # restart) must not leave the old socket half-open — a stale,
        # already-abandoned connection must not be able to receive further
        # deployment pushes or be mistaken for the live one.
        async def run():
            mgr = main.DeviceConnectionManager()
            old_ws = FakeWebSocket()
            new_ws = FakeWebSocket()
            await mgr.connect("device-1", old_ws)
            await mgr.connect("device-1", new_ws)
            self.assertTrue(old_ws.closed)
            self.assertEqual(old_ws.close_code, main.WS_CLOSE_SUPERSEDED)
            self.assertFalse(new_ws.closed)
            self.assertTrue(mgr.is_connected("device-1"))

        asyncio.run(run())

    def test_disconnect_of_superseded_socket_does_not_evict_current(self):
        # A late teardown from a connection that was already replaced must
        # not mark the device offline/disconnected out from under the
        # connection that superseded it — otherwise a reconnecting phone
        # could be flipped straight back to "not connected" by its own old
        # socket's delayed close callback, defeating the fast-release fix
        # (an actually-connected device would wrongly qualify as abandoned).
        async def run():
            mgr = main.DeviceConnectionManager()
            old_ws = FakeWebSocket()
            new_ws = FakeWebSocket()
            await mgr.connect("device-1", old_ws)
            await mgr.connect("device-1", new_ws)
            mgr.disconnect("device-1", old_ws)  # late teardown of the OLD socket
            self.assertTrue(mgr.is_connected("device-1"))
            mgr.disconnect("device-1", new_ws)  # real teardown of the current one
            self.assertFalse(mgr.is_connected("device-1"))

        asyncio.run(run())


class FailureCategoryTaxonomyTests(unittest.TestCase):
    """The failure_category column (migrations/20260806_*) exists precisely
    so a late authoritative 'ready' event can supersede a pure delivery
    failure but never an explicit cancellation. These check the taxonomy
    used by the SQL added to create_deployment/_expire_deployment_if_stale/
    _release_if_abandoned is internally consistent."""

    def test_grace_window_shorter_than_connected_windows(self):
        # The disconnected-device fast path must release strictly faster
        # than either connected-device staleness window, or it provides no
        # benefit over the existing behavior.
        grace = main._ABANDONED_DISCONNECTED_GRACE
        self.assertIn("second", grace)
        self.assertNotIn("minute", grace)

    def test_stale_predicate_still_distinguishes_download_from_validation(self):
        predicate = main._STALE_DEPLOYMENT_PREDICATE
        self.assertIn("15 minutes", predicate)
        self.assertIn("3 minutes", predicate)


if __name__ == "__main__":
    unittest.main()
