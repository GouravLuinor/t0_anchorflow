#!/bin/sh
set -eu

echo "=========================================="
echo "Deploying Anchorflow on VPS..."
echo "=========================================="

# 0. Supply-chain PRE-FLIGHT (M8): never `git reset --hard` a workspace that
#    still carries uncommitted work — that is how a local fix gets destroyed by
#    a deploy. Refuse and say exactly what to do instead.
if [ -d ".git" ]; then
    if [ -n "$(git status --porcelain)" ]; then
        echo "REFUSING TO DEPLOY: the workspace is dirty."
        echo
        echo "Uncommitted changes would be lost by the reset below."
        echo "Commit or stash them first:"
        echo "  git status --porcelain        # see what is dirty"
        echo "  git stash push -u            # or: git add -A && git commit"
        echo
        git status --short
        exit 1
    fi
fi

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

# 2. Build and restart PM2 process
echo "Installing production dependencies & building..."
npm ci
npm run build
# Stage standalone assets as required by Next.js standalone output
cp -r public .next/standalone/ || true
cp -r .next/static .next/standalone/.next/ || true

echo "Managing PM2 process (anchor-norai)..."
pm2 restart anchor-norai || pm2 start ecosystem.config.js
pm2 save

echo "=========================================="
echo "Anchorflow deployed successfully on PM2!"
echo "=========================================="
