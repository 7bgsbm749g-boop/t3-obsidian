#!/usr/bin/env python3
"""Retired direct-deploy entry point.

Keeping this refusal in place prevents an old runbook from bypassing version
bumping, tests, immutable packaging, the development install, and smoke-test
receipts.
"""

raise SystemExit(
    'Direct deployment is retired. Run: npm run release:qlo2 -- --bump patch '
    '(or minor/major) from /home/ubuntu/projects/send-to-t3-code.'
)
