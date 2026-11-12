# Dockerfile sample for Treelights tests.
FROM python:3.13-slim AS base
ARG VERSION=1.0
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    useradd -m scanner
USER scanner
EXPOSE 8080
CMD ["python", "scan.py", "--host", "10.0.0.1"]
