#!/bin/bash
set -euo pipefail

SERVICE="gravespeaker"
PROJECT_ID="anchildress1"
REGION="us-east1"

if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI is not installed." >&2
    exit 1
fi

echo "Deploying $SERVICE to $PROJECT_ID ($REGION)"

gcloud services enable artifactregistry.googleapis.com cloudbuild.googleapis.com \
    run.googleapis.com secretmanager.googleapis.com --project "$PROJECT_ID" --quiet

# Secrets are namespaced per app in the shared project; never reuse another app's key.
gcloud run deploy "$SERVICE" \
    --source . \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --service-account "$SERVICE-run@$PROJECT_ID.iam.gserviceaccount.com" \
    --set-secrets "GEMINI_API_KEY=GRAVESPEAKER_GEMINI_API_KEY:latest,SERPAPI_API_KEY=GRAVESPEAKER_SERPAPI_API_KEY:latest,ELEVENLABS_API_KEY=GRAVESPEAKER_ELEVENLABS_API_KEY:latest" \
    --allow-unauthenticated \
    --cpu-boost \
    --port 8080
