#!/bin/sh
set -eu

echo "=========================================="
echo "Deploying Anchorflow on VPS..."
echo "=========================================="

# 1. Supply-chain gate: fetch and compare SHAs, then require explicit
#    confirmation (DEPLOY_CONFIRM=1 or first arg "confirm") before the
#    workspace is reset to origin/main. Never blind-pull.
if [ -d ".git" ]; then
    echo "Fetching origin..."
    git fetch origin

    LOCAL_SHA=$(git rev-parse HEAD)
    REMOTE_SHA=$(git rev-parse origin/main)

    echo "Local HEAD  : $LOCAL_SHA"
    echo "origin/main : $REMOTE_SHA"

    if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
        echo "Workspace differs from origin/main."
    fi

    if [ "${DEPLOY_CONFIRM:-}" != "1" ] && [ "${1:-}" != "confirm" ]; then
        echo "Refusing to reset local code without confirmation."
        echo "Re-run as: DEPLOY_CONFIRM=1 ./deploy.sh   (or: ./deploy.sh confirm)"
        exit 1
    fi

    echo "Resetting workspace to origin/main..."
    git reset --hard origin/main
fi

# 2. Build and restart Docker containers
echo "Building Docker image & starting container..."
docker compose build --pull
docker compose up -d --remove-orphans

# 3. Prune dangling build images to save VPS disk space
echo "Cleaning up dangling build images..."
docker image prune -f

# 4. Check container health status
echo "Verifying container health..."
sleep 5
docker compose ps

echo "=========================================="
echo "Anchorflow deployed successfully!"
echo "=========================================="
