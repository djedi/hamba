# Backend Dockerfile
# Builds the Rust (axum) API server

FROM rust:1-slim-bookworm AS builder
WORKDIR /app

# OpenSSL is needed by webauthn-rs (passkeys)
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# release (CI) or fast-release (`make deploy`); see Cargo.toml
ARG CARGO_PROFILE=release

COPY . .
# Cache mounts keep the crate registry and build output between builds on the same host
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target,id=hamba-target-${CARGO_PROFILE} \
    cargo build --profile ${CARGO_PROFILE} && \
    cp target/${CARGO_PROFILE}/hamba-backend /usr/local/bin/hamba-backend

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

COPY --from=builder /usr/local/bin/hamba-backend /usr/local/bin/hamba-backend

USER hamba

EXPOSE 8877
ENV PORT=8877

# The database file will be stored in /app/data
# Mount a volume to persist it: -v ./data:/app/data
ENV DATABASE_PATH=/app/data/hamba.db

CMD ["hamba-backend"]
