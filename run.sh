#!/bin/bash

# Ensure data and backup directories exist on the host
mkdir -p data data/backups

# Check if the data directory is currently owned by root (UID 0)
if [ "$(stat -c '%u' data 2>/dev/null)" = "0" ]; then
    echo "⚠️  The 'data' directory is owned by root. Fixing permissions..."
    sudo chown -R "$(id -u):$(id -g)" data
fi

# Start the docker container (passes any command-line arguments to docker compose up)
echo "🚀 Starting open-api-erp container..."
docker compose up -d
