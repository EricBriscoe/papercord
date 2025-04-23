FROM node:alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache \
    python3 \
    py3-pip \
    build-base \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pkgconf

# Copy package files and install dependencies with all native modules built
COPY package*.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build the TypeScript project
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# Production image
FROM node:alpine

WORKDIR /app

# Install Python and required packages, plus runtime dependencies for canvas
RUN apk add --no-cache \
    python3 \
    py3-pip \
    bash \
    cairo \
    jpeg \
    pango \
    giflib \
    tzdata \
    pkgconf \
    build-base \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    python3-dev

# Create and use a Python virtual environment
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Install Python packages for the YF service
RUN pip install --no-cache-dir yfinance flask

# Create data directory for SQLite database
RUN mkdir -p /app/data/cache/charts && \
    chown -R node:node /app

# Copy package files
COPY package*.json ./

# Copy node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Copy Python services
COPY src/python_services/ ./src/python_services/

# Copy scripts directory
COPY scripts/ ./scripts/

# Ensure scripts are executable
RUN chmod +x ./scripts/*.sh ./src/python_services/*.sh ./src/python_services/*.py

# Use non-root user for better security
USER node

# Set environment variables
ENV NODE_ENV=production
ENV YF_PYTHON_SERVICE_URL=http://localhost:3001

# Start services with auto-restart capability
CMD ["bash", "./scripts/start-services.sh"]