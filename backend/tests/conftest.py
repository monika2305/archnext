"""Tests that do not choose a detection mode use Standard, so they do not depend on the optional AI model."""
import os

os.environ.setdefault("ARCHNEXT_DETECTION", "standard")
