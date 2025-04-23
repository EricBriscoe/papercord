#!/bin/bash

# Start Yahoo Finance Python service
# This script activates the virtual environment and starts the Flask server

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# If we're in the Docker container, use the container's virtual env path
if [ -d "/app/venv" ]; then
    source "/app/venv/bin/activate"
else
    # Otherwise use the local dev environment path 
    source "$PROJECT_ROOT/venv/bin/activate" 2>/dev/null || echo "Virtual environment not found at $PROJECT_ROOT/venv"
fi

# Make the Python script executable
chmod +x "$SCRIPT_DIR/yf_service.py"

echo "Starting Yahoo Finance Python service on port 3001..."
# Start the service
exec "$SCRIPT_DIR/yf_service.py"