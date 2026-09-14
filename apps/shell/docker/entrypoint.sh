#!/bin/sh
# One shell image runs in every environment: the PLATFORM_* variables passed to `docker run`
# become /platform-env.json, which the page fetches before anything else.
set -eu
: "${PLATFORM_ENVIRONMENT:?PLATFORM_ENVIRONMENT is required (dev | staging | production)}"
: "${PLATFORM_REGISTRY_URL:?PLATFORM_REGISTRY_URL is required}"
: "${PLATFORM_CDN_URL:=$PLATFORM_REGISTRY_URL}"
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
cat > /usr/share/nginx/html/platform-env.json <<JSON
{
  "PLATFORM_ENVIRONMENT": "$(json_escape "$PLATFORM_ENVIRONMENT")",
  "PLATFORM_REGISTRY_URL": "$(json_escape "$PLATFORM_REGISTRY_URL")",
  "PLATFORM_CDN_URL": "$(json_escape "$PLATFORM_CDN_URL")",
  "PLATFORM_API_ORIGINS": "$(json_escape "${PLATFORM_API_ORIGINS:-}")",
  "PLATFORM_HUB_URL": "$(json_escape "${PLATFORM_HUB_URL:-}")",
  "PLATFORM_IDENTITY_URL": "$(json_escape "${PLATFORM_IDENTITY_URL:-dev}")",
  "PLATFORM_CONFIG_URL": "$(json_escape "${PLATFORM_CONFIG_URL:-}")",
  "PLATFORM_TELEMETRY_URL": "$(json_escape "${PLATFORM_TELEMETRY_URL:-}")"
}
JSON
exec nginx -g 'daemon off;'
