# Backend Dockerfile
# Uses Bun runtime for running the Elysia API server

FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install

# Production image
FROM base AS runner
WORKDIR /app

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs hamba

# Copy dependencies and source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown -R hamba:nodejs /app/data

USER hamba

# Expose API port
EXPOSE 3001

# Default environment variables
ENV NODE_ENV=production
ENV PORT=3001

# The database file will be stored in /app/data
# Mount a volume to persist it: -v ./data:/app/data
ENV DATABASE_PATH=/app/data/hamba.db

# Start the server
CMD ["bun", "run", "src/index.ts"]
