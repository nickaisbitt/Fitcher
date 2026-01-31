#!/bin/bash

# Prefetch historical data for BTC/USD and ETH/USD from 2020 to present
# This script triggers the data ingestion API

echo "=== Fitcher Historical Data Prefetch ==="
echo "Fetching BTC/USD and ETH/USD from 2020 to present"
echo "This will take 4-6 hours for full download"
echo ""

# You need to get a JWT token first by logging in
# Example:
# TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
#   -H "Content-Type: application/json" \
#   -d '{"email": "your@email.com", "password": "yourpassword"}' | jq -r '.data.accessToken')

if [ -z "$TOKEN" ]; then
    echo "Please set your JWT token in the TOKEN environment variable"
    echo "Example: export TOKEN=your_jwt_token_here"
    exit 1
fi

echo "1. Checking current data status..."
curl -s -X GET http://localhost:3000/api/data/status \
  -H "Authorization: Bearer $TOKEN" | jq

echo ""
echo "2. Triggering pre-fetch job..."
curl -s -X POST http://localhost:3000/api/data/prefetch \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq

echo ""
echo "3. Monitoring job progress (check every 30 seconds)..."
echo "Press Ctrl+C to stop monitoring (jobs will continue in background)"

while true; do
    sleep 30
    echo ""
    echo "--- Status Update ---"
    curl -s -X GET http://localhost:3000/api/data/status \
      -H "Authorization: Bearer $TOKEN" | jq '.data.activeJobs'
done
