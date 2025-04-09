FROM node:20-alpine AS builder

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
FROM node:20-alpine

WORKDIR /app

# Create data directory for SQLite database
RUN mkdir -p /app/data && \
    chown -R node:node /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Use non-root user for better security
USER node

# Set environment variables
ENV NODE_ENV=production

# Command to run the bot
CMD ["node", "dist/index.js"]