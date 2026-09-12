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

COPY app app

RUN groupadd -g 1000 chord && useradd -u 1000 -g chord -m chord && chown -R chord:chord /app
USER chord

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
