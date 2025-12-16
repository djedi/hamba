# Frontend Dockerfile
# Builds SvelteKit static site and serves via nginx

# Development stage - installs deps only, no build
FROM oven/bun:1 AS dev
WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install

# Copy source files
COPY . .

# Expose dev server port
EXPOSE 8878

# Default command for dev (can be overridden)
CMD ["bun", "run", "dev", "--host", "0.0.0.0", "--port", "8878"]

# Builder stage - builds static site for production
FROM dev AS builder

# Build the static site
RUN bun run build

# Production image with nginx
FROM nginx:alpine AS runner

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=builder /app/build /usr/share/nginx/html

# Expose HTTP port
EXPOSE 80

# nginx runs as non-root by default in alpine image
CMD ["nginx", "-g", "daemon off;"]
