FROM python:3.11-slim AS base

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/reports /app/data
ENV CHECKPOINT_DB=/app/data/checkpoints.sqlite \
    REPORTS_DIR=/app/reports \
    TOOLS_CONFIG=/app/config/tools.yaml

EXPOSE 8000

CMD ["python", "-m", "app", "--help"]
