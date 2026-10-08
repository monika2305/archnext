@echo off
REM Development backend: restarts by itself when backend code changes, so it never serves older code than the
REM interface (plans survive the restart: they are autosaved). start_demo.bat runs without auto-reload.
cd /d "%~dp0backend"
call .venv\Scripts\activate.bat
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app
