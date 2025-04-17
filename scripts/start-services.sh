#!/bin/bash

# Service management script with auto-restart capability
# This script starts both the Node.js app and the Python service
# and monitors them to restart if they crash

# Function to start the Node.js app with monitoring
start_node_app() {
  echo "Starting Node.js application..."
  while true; do
    node dist/index.js
    EXIT_CODE=$?
    
    echo "Node.js application exited with code $EXIT_CODE at $(date)"
    
    # Sleep briefly before restarting to avoid rapid restart cycles
    # if the app is failing immediately on startup
    sleep 3
    
    echo "Restarting Node.js application..."
  done
}

# Function to start the Python service
start_python_service() {
  echo "Starting Python service..."
  ./src/python_services/start_service.sh
}

# Start both services in background with their own monitoring
start_node_app &
NODE_PID=$!

start_python_service &
PYTHON_PID=$!

# Handle termination signals
trap "kill $NODE_PID $PYTHON_PID; exit" SIGINT SIGTERM

# Wait for both processes
wait