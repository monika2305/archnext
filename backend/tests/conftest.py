"""Tests that do not choose a detection mode use Standard, so they do not depend on the optional AI model.
Autosaves go to a temporary folder, never to backend/data."""
import os
import tempfile

os.environ.setdefault("ARCHNEXT_DETECTION", "standard")
os.environ["ARCHNEXT_DATA_DIR"] = tempfile.mkdtemp(prefix="archnext-test-sessions-")
