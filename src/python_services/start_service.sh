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

echo "Starting Yahoo Finance Python service with Gunicorn on port 3001..."
# Start the service with Gunicorn
# --workers: Number of worker processes. Adjust as needed.
# --bind: Address and port to bind to.
# --chdir: Change directory to the script's location so Gunicorn can find the module.
# 'yf_service:app': The module and Flask app instance (yf_service.py should contain `app = Flask(__name__)`).
exec gunicorn --workers 2 --bind 0.0.0.0:3001 --chdir "$SCRIPT_DIR" 'yf_service:app'
