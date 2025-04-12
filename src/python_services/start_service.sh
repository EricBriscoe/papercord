#!/bin/bash

# Start Yahoo Finance Python service
# This script activates the virtual environment and starts the Flask server

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Activate virtual environment
source "$PROJECT_ROOT/venv/bin/activate"

# Make the Python script executable
chmod +x "$SCRIPT_DIR/yf_service.py"

echo "Starting Yahoo Finance Python service on port 3001..."
# Start the service
exec "$SCRIPT_DIR/yf_service.py"