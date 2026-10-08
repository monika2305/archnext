"""ArchNext Mode B: room walkthrough video -> evidence-aware 3D scene (VisionTrust, GeometryTrust, NextBestView).

Independent of Mode A (blueprint -> 3D): own API router (/api/mode-b/*), own projects folder, own worker process
and Python environment (backend/mode_b/.venv, see mode_b/README.md). The API part imports only the standard
library and FastAPI, so it runs inside the Mode A backend process without touching Mode A's dependencies.
"""
