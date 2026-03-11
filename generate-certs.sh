#!/usr/bin/env bash
# Generates a self-signed certificate for local development
set -e
mkdir -p nginx/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout nginx/certs/key.pem \
  -out nginx/certs/cert.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
echo "Certs written to nginx/certs/"
