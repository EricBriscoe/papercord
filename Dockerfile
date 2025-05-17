# syntax=docker/dockerfile:1.4

# Node build stage
FROM node:18-alpine AS node-builder
WORKDIR /app
RUN apk add --no-cache python3 py3-pip build-base pkgconf cairo-dev jpeg-dev pango-dev giflib-dev ttf-dejavu
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

# Python build stage
FROM node:18-alpine AS python-builder
WORKDIR /app
RUN apk add --no-cache python3 py3-pip bash build-base pkgconf cairo-dev jpeg-dev pango-dev giflib-dev python3-dev ttf-dejavu tzdata
RUN python3 -m venv /venv
ENV PATH="/venv/bin:$PATH"
COPY src/python_services/requirements.txt ./requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip pip install --no-cache-dir -r requirements.txt

# Production stage
FROM node:18-alpine AS production
WORKDIR /app
# Runtime dependencies only
RUN apk add --no-cache python3 bash cairo jpeg pango giflib tzdata ttf-dejavu pkgconf
# Copy node artifacts
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/dist ./dist
# Copy python virtual environment
COPY --from=python-builder /venv /venv
ENV PATH="/venv/bin:$PATH"
# Copy application scripts and services
COPY scripts ./scripts
COPY src/python_services ./src/python_services
RUN chmod +x scripts/*.sh src/python_services/*.sh src/python_services/*.py
# Create data directory and set permissions
RUN mkdir -p data/cache/charts && chown -R node:node /app
USER node
ENV NODE_ENV=production
ENV YF_PYTHON_SERVICE_URL=http://localhost:3001
CMD ["bash", "scripts/start-services.sh"]
