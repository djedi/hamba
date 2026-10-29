#!/bin/bash
set -e

# Get the target triple for the current platform
get_target_triple() {
    local arch=$(uname -m)
    local os=$(uname -s)

    case "$os" in
        Darwin)
            case "$arch" in
                arm64) echo "aarch64-apple-darwin" ;;
                x86_64) echo "x86_64-apple-darwin" ;;
            esac
            ;;
        Linux)
            case "$arch" in
                aarch64) echo "aarch64-unknown-linux-gnu" ;;
                x86_64) echo "x86_64-unknown-linux-gnu" ;;
            esac
            ;;
    esac
}

TARGET_TRIPLE=$(get_target_triple)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$(dirname "$FRONTEND_DIR")/backend"
OUTPUT_DIR="$FRONTEND_DIR/src-tauri/binaries"

echo "Building backend sidecar for $TARGET_TRIPLE..."

cd "$BACKEND_DIR"

# Build optimized Rust binary and copy it where Tauri expects the sidecar
cargo build --release
mkdir -p "$OUTPUT_DIR"
cp target/release/hamba-backend "$OUTPUT_DIR/backend-$TARGET_TRIPLE"

echo "Sidecar built: $OUTPUT_DIR/backend-$TARGET_TRIPLE"
