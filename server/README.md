# CHORD server

FastAPI service that separates an uploaded MP3 into stems (Demucs) and detects
chords/key (madmom). Runs locally against the machine's GPU; designed to be
host-agnostic so it can move to a different server later without a rewrite.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate

# Install PyTorch + torchaudio matched to your CUDA driver first (check
# https://pytorch.org/get-started/locally/ for the current index URL):
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124

pip install -r requirements.txt

# madmom (chord/key detection) is unmaintained since 2018 and needs manual steps:
sudo apt-get install -y python3.10-dev build-essential   # Python.h for its C extensions
pip install cython wheel
pip install madmom --no-build-isolation
bash scripts/patch_madmom.sh   # fixes Python 3.10 / modern-numpy incompatibilities
```

## Run

```bash
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

The first separation downloads the `htdemucs_6s` pretrained weights from the
Hugging Face Hub into `~/.cache/huggingface` (cached after that). The Docker image
bakes them in instead.

## Data layout

Everything under `data/` is runtime-only and gitignored:

```
data/db.sqlite3           # job metadata
data/models_cache/        # TORCH_HOME: demucs' fallback download cache, normally empty
data/jobs/<job_id>/
  original.mp3
  stems/{vocals,drums,bass,guitar,piano,other}.flac
  analysis/{chords.json,key.json}
```
