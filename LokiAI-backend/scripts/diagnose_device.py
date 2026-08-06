#!/usr/bin/env python3
"""Pulls real production evidence for one device from the live backend and
prints a readable report: deployment history (status, timing, failure
detail) and recent runtime telemetry (validation/smoke-test/inference
events). Built so a "the model deployed but shows failed" report can be
diagnosed from actual data instead of guessing.

Usage:
    python scripts/diagnose_device.py --device-id <uuid> --token <bearer-token>

    Or set env vars instead of flags:
        LOKIAI_TOKEN=...  LOKIAI_DEVICE_ID=...  python scripts/diagnose_device.py

Getting a token: open the dashboard in your browser, open DevTools ->
Network tab, reload, click any authenticated request (e.g. GET /devices),
and copy the value after "Bearer " in its Authorization request header.
Tokens expire after 30 minutes (ACCESS_TOKEN_TTL_MINUTES) — get a fresh one
if this returns 401.

This never touches the database directly — it only calls the same
authenticated REST API the dashboard itself uses, so it needs no database
credentials and can't see or affect any other user's data.
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from typing import Optional

import httpx

DEFAULT_BACKEND = "https://lokiai-uznh.onrender.com"


def _age(iso_timestamp: Optional[str]) -> str:
    if not iso_timestamp:
        return "never"
    then = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
    seconds = (datetime.now(timezone.utc) - then).total_seconds()
    if seconds < 60:
        return f"{seconds:.0f}s ago"
    if seconds < 3600:
        return f"{seconds / 60:.1f}m ago"
    return f"{seconds / 3600:.1f}h ago"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device-id", default=os.environ.get("LOKIAI_DEVICE_ID"))
    parser.add_argument("--token", default=os.environ.get("LOKIAI_TOKEN"))
    parser.add_argument("--backend", default=os.environ.get("LOKIAI_BACKEND", DEFAULT_BACKEND))
    parser.add_argument("--deployments", type=int, default=10, help="how many recent deployments to show")
    parser.add_argument("--events", type=int, default=30, help="how many recent runtime events to show")
    args = parser.parse_args()

    if not args.device_id or not args.token:
        parser.error("--device-id and --token are required (or LOKIAI_DEVICE_ID / LOKIAI_TOKEN env vars)")

    url = f"{args.backend}/devices/{args.device_id}/diagnostics"
    try:
        resp = httpx.get(
            url,
            headers={"Authorization": f"Bearer {args.token}"},
            params={"deployment_limit": args.deployments, "event_limit": args.events},
            timeout=20.0,
        )
    except httpx.HTTPError as e:
        print(f"Could not reach {args.backend}: {e}", file=sys.stderr)
        return 1

    if resp.status_code == 401:
        print("401 Unauthorized — the token is missing, expired, or malformed.\n"
              "Tokens expire 30 minutes after login; get a fresh one from the browser.", file=sys.stderr)
        return 1
    if resp.status_code == 404:
        print("404 — that device_id doesn't exist, or doesn't belong to this account.", file=sys.stderr)
        return 1
    if resp.status_code != 200:
        print(f"HTTP {resp.status_code}: {resp.text[:500]}", file=sys.stderr)
        return 1

    data = resp.json()
    device = data["device"]
    deployments = data["deployments"]
    events = data["runtime_events"]

    print("=" * 72)
    print(f"DEVICE  {device['phone_model'] or device['id']}  ({device['id']})")
    print(f"  connection status : {device['status']}  "
          f"(websocket currently {'CONNECTED' if device['websocket_connected'] else 'NOT CONNECTED'})")
    print(f"  last seen         : {device['last_seen']} ({_age(device['last_seen'])})")
    print("=" * 72)

    print(f"\nDEPLOYMENTS (most recent {len(deployments)})")
    print("-" * 72)
    for d in deployments:
        name = d["model_name"] or d["hf_model_id"] or "(unknown model)"
        print(f"  [{d['status'].upper():10}] {name}")
        print(f"      size={d['size_mb']} MB  adapter={d['adapter_id']}  progress={d['progress']}%")
        print(f"      deployed  : {d['deployed_at']} ({_age(d['deployed_at'])})")
        print(f"      updated   : {d['updated_at']} ({_age(d['updated_at'])})"
              f"  <- {d['seconds_since_last_update']}s since last activity")
        if d["completed_at"]:
            print(f"      completed : {d['completed_at']} ({_age(d['completed_at'])})")
        if d["error_message"] or d["failure_code"]:
            print(f"      FAILURE   : {d['failure_code']} — {d['error_message'] or d['failure_details']}")
        print()

    print(f"RUNTIME EVENTS (most recent {len(events)})")
    print("-" * 72)
    if not events:
        print("  (none — the phone has never reported a runtime_event for this device)")
    for e in events:
        status = "OK" if e["success"] else ("FAIL" if e["success"] is False else "?")
        print(f"  [{status:4}] {e['event_type']:20} op={e['operation']}  "
              f"adapter={e['adapter_id']}  {_age(e['occurred_at'])}")
        if e["error_code"]:
            print(f"          error: {e['error_code']} — {e['error_detail']}")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
