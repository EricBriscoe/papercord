FROM node:23 AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    build-essential \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    pkg-config

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build the TypeScript project
RUN npm run build

# Production image
FROM node:23-slim

WORKDIR /app

# Install Python and required packages, plus runtime dependencies for canvas
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    bash \
    libcairo2 \
    libjpeg62-turbo \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgif7 \
    pkg-config \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

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