#!/bin/bash
set -euo pipefail

SERVICE="gravespeaker"
REGION="us-east1"

if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI is not installed." >&2
    exit 1
fi

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [[ "$PROJECT_ID" == "(unset)" ]] || [[ -z "$PROJECT_ID" ]]; then
    echo "Error: No Google Cloud Project ID set." >&2
    exit 1
fi

echo "Deploying $SERVICE to $PROJECT_ID ($REGION)"

gcloud services enable artifactregistry.googleapis.com cloudbuild.googleapis.com \
    run.googleapis.com secretmanager.googleapis.com --project "$PROJECT_ID" --quiet

# API keys come from Secret Manager so they never appear in build logs or service config.
gcloud run deploy "$SERVICE" \
    --source . \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --service-account "$SERVICE@$PROJECT_ID.iam.gserviceaccount.com" \
    --set-secrets "GEMINI_API_KEY=gemini-api-key:latest,SERPAPI_API_KEY=serpapi-api-key:latest" \
    --allow-unauthenticated \
    --cpu-boost \
    --port 8080
