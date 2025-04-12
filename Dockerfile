FROM node:23-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build the TypeScript project
RUN npm run build

# Production image
FROM node:23-alpine

WORKDIR /app

# Install Python and required packages
RUN apk add --no-cache python3 py3-pip bash
RUN python3 -m pip install --no-cache-dir yfinance flask

# Create data directory for SQLite database
RUN mkdir -p /app/data && \
    chown -R node:node /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Copy Python services
COPY src/python_services/ ./src/python_services/

# Ensure scripts are executable
RUN chmod +x ./src/python_services/*.sh ./src/python_services/*.py

# Use non-root user for better security
USER node

# Set environment variables
ENV NODE_ENV=production
ENV YF_PYTHON_SERVICE_URL=http://localhost:3001

# Start both the Python service and Node app
CMD sh -c "node dist/index.js & ./src/python_services/start_service.sh"