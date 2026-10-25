"""Environment configuration. Reads DOCTRUST_ prefixed vars / .env."""
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

REPO_ROOT = Path(__file__).resolve().parent.parent

FORENSIC_MODE = os.environ.get("DOCTRUST_FORENSIC_MODE", "metadata")   # metadata | ela | off
FORCE_SYNTH = os.environ.get("DOCTRUST_FORCE_SYNTH", "").lower() in ("1", "true", "yes")
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "DOCTRUST_CORS_ORIGINS",
        # CRA dev server (:3000) and the static build server (:4173)
        "http://localhost:3000,http://localhost:4173",
    ).split(",")
    if o.strip()
]
LLM_BASE_URL = os.environ.get("DOCTRUST_LLM_BASE_URL", "").rstrip("/")
LLM_API_KEY = os.environ.get("DOCTRUST_LLM_API_KEY", "")
LLM_MODEL = os.environ.get("DOCTRUST_LLM_MODEL", "gpt-4o-mini")
LLM_TIMEOUT_S = float(os.environ.get("DOCTRUST_LLM_TIMEOUT", "10"))

if __name__ == "__main__":
    print("CONFIG")
    for _k, _v in sorted(os.environ.items()):
        if _k.startswith("DOCTRUST_"):
            print(f"  {_k} = {_v}")
    sys.exit(0)
