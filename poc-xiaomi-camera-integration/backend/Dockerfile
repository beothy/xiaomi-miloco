FROM python:3.11-slim

WORKDIR /app

# Install miot_kit system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install miot_kit from parent repo
COPY miot_kit ./miot_kit
RUN pip install --no-cache-dir ./miot_kit

# Install PoC backend dependencies
COPY poc-xiaomi-camera-integration/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY poc-xiaomi-camera-integration/backend/ ./

CMD ["python", "main.py"]
