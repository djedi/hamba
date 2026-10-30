# Backend Dockerfile
# Builds the Rust (axum) API server

FROM rust:1-slim-bookworm AS builder
WORKDIR /app

# OpenSSL is needed by webauthn-rs (passkeys)
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Cache dependencies separately from sources
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

COPY . .
RUN touch src/main.rs && cargo build --release

# Development image: run with hot rebuild via `cargo run` (see docker-compose.dev.yml)
FROM builder AS dev
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
CMD ["cargo", "run"]

# Production image
FROM debian:bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libssl3 && rm -rf /var/lib/apt/lists/* && \
    groupadd --system --gid 1001 hamba && \
    useradd --system --uid 1001 --gid hamba hamba && \
    mkdir -p /app/data && chown -R hamba:hamba /app/data

COPY --from=builder /app/target/release/hamba-backend /usr/local/bin/hamba-backend

USER hamba

EXPOSE 8877
ENV PORT=8877

# The database file will be stored in /app/data
# Mount a volume to persist it: -v ./data:/app/data
ENV DATABASE_PATH=/app/data/hamba.db

CMD ["hamba-backend"]
