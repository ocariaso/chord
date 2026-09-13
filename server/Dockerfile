FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      build-essential \
      pkg-config \
      libopus-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir torch torchaudio --extra-index-url ${TORCH_INDEX_URL}

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN pip install --no-cache-dir cython wheel && \
    pip install --no-cache-dir madmom --no-build-isolation
COPY scripts/patch_madmom.sh scripts/patch_madmom.sh
RUN bash scripts/patch_madmom.sh

# The separation weights are baked in rather than fetched by the first job: demucs pulls them from the
# Hugging Face Hub into HF_HOME, which isn't on the data volume, so every rebuild would download them
# again. Offline at runtime, the server reads this copy and never calls the Hub. get_hf_model, not
# get_model: get_model swallows a Hub failure and falls back to demucs' legacy download, which would
# leave the build green and HF_HOME empty.
ARG DEMUCS_MODEL=htdemucs_6s
ENV HF_HOME=/opt/models/huggingface \
    DEMUCS_MODEL=${DEMUCS_MODEL}
RUN python -c "from demucs.hf import get_hf_model; get_hf_model('${DEMUCS_MODEL}')"
ENV HF_HUB_OFFLINE=1

COPY app app

RUN groupadd -g 1000 chord && useradd -u 1000 -g chord -m chord && chown -R chord:chord /app
USER chord

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
