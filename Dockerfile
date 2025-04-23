FROM node:23-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev

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
RUN apk add --no-cache python3 py3-pip bash cairo jpeg pango giflib

# Create and use a Python virtual environment
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Now install Python packages in the virtual environment
RUN pip install --no-cache-dir yfinance flask

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

# Copy service management scripts
COPY scripts/ ./scripts/

# Ensure scripts are executable
RUN chmod +x ./src/python_services/*.sh ./src/python_services/*.py ./scripts/*.sh

# Use non-root user for better security
USER node

# Set environment variables
ENV NODE_ENV=production
ENV YF_PYTHON_SERVICE_URL=http://localhost:3001

# Start services with auto-restart capability
CMD ["./scripts/start-services.sh"]