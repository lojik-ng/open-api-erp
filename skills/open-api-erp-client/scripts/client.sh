#!/usr/bin/env bash
set -euo pipefail

# Default configuration
BASE_URL="${ERP_BASE_URL:-http://localhost:11122/v1}"
API_KEY="${ERP_API_KEY:-}"

# Try loading from .env if it exists in the parent directory
if [ -z "$API_KEY" ] && [ -f "../../.env" ]; then
  API_KEY=$(grep -E "^(ERP_)?API_KEY=" ../../.env | head -n 1 | cut -d'=' -f2- || true)
fi

# Load from ~/.erp/credentials if present
if [ -z "$API_KEY" ] && [ -f "$HOME/.erp/credentials" ]; then
  API_KEY=$(cat "$HOME/.erp/credentials")
fi

METHOD="${1:-}"
PATH_PART="${2:-}"
BODY="${3:-}"
IDEMPOTENCY_KEY="${4:-}"

if [ -z "$METHOD" ] || [ -z "$PATH_PART" ]; then
  echo "Usage: $0 {GET|POST|PUT|DELETE|PATCH} {path} [json-body] [idempotency-key]" >&2
  echo "Example: $0 GET crm/leads" >&2
  echo "Example: $0 POST crm/leads '{\"first_name\": \"John\", \"last_name\": \"Doe\"}'" >&2
  exit 1
fi

# Clean up path slashes
PATH_PART="${PATH_PART#/}"
URL="${BASE_URL}/${PATH_PART}"

if [ -z "$API_KEY" ] && [ "$PATH_PART" != "health" ] && [ "$PATH_PART" != "api-docs/openapi.json" ]; then
  echo "Error: ERP_API_KEY is not set. Please set it as an environment variable or write it to ~/.erp/credentials" >&2
  exit 1
fi

# Build headers
HEADERS=(
  "-H" "Content-Type: application/json"
)

if [ ! -z "$API_KEY" ]; then
  HEADERS+=("-H" "x-api-key: ${API_KEY}")
fi

if [ ! -z "$IDEMPOTENCY_KEY" ]; then
  HEADERS+=("-H" "Idempotency-Key: ${IDEMPOTENCY_KEY}")
fi

if [ "$METHOD" = "GET" ] || [ "$METHOD" = "DELETE" ]; then
  curl -sS -X "$METHOD" "${HEADERS[@]}" "$URL"
else
  if [ -z "$BODY" ]; then
    BODY="{}"
  fi
  curl -sS -X "$METHOD" "${HEADERS[@]}" -d "$BODY" "$URL"
fi
