# Hamba development tasks. Run `make help` for the list.
#
# `make up` starts the Docker dev stack on free host ports and opens the app.
# Ports are picked once and saved to .dev-ports so the URL (and the browser's
# per-origin storage) stays stable. Pin them with e.g. `BACKEND_PORT=8877 make up`
# (needed for OAuth, whose redirect URIs are registered with a fixed port), or
# `make reset-ports` to pick new ones.

SHELL := /bin/bash
.DEFAULT_GOAL := help

PROJECT := hamba
COMPOSE := docker compose -p $(PROJECT) -f docker-compose.dev.yml
PORTS_FILE := .dev-ports
SERVICE ?=

# Ask the OS for a free TCP port
free_port = $(shell python3 -c 'import socket; s=socket.socket(); s.bind(("", 0)); print(s.getsockname()[1])')

# Saved ports win over fresh random ones; values from the environment win over both
-include $(PORTS_FILE)
ifndef BACKEND_PORT
BACKEND_PORT := $(free_port)
endif
ifndef FRONTEND_PORT
FRONTEND_PORT := $(free_port)
endif
export BACKEND_PORT FRONTEND_PORT

APP_URL := http://localhost:$(FRONTEND_PORT)
API_URL := http://localhost:$(BACKEND_PORT)

##@ Docker

.PHONY: up
up: $(PORTS_FILE) .env ## Start the stack in the background, wait for it, open the browser
	$(COMPOSE) up -d --build
	@$(MAKE) --no-print-directory wait
	@open "$(APP_URL)" 2>/dev/null || xdg-open "$(APP_URL)" 2>/dev/null || true
	@echo "Frontend: $(APP_URL)"
	@echo "Backend:  $(API_URL)  (docs: $(API_URL)/docs)"
	@echo "Logs:     make logs"

.PHONY: down
down: ## Stop and remove containers
	$(COMPOSE) down

.PHONY: restart
restart: down up ## Restart the stack (backend recompiles with cargo run)

.PHONY: build
build: ## Build images without starting
	$(COMPOSE) build

.PHONY: rebuild
rebuild: ## Rebuild images with --no-cache, then start
	$(COMPOSE) build --no-cache
	@$(MAKE) --no-print-directory up

.PHONY: logs
logs: ## Follow logs (all services, or SERVICE=backend|frontend)
	$(COMPOSE) logs -f $(SERVICE)

.PHONY: status
status: ## Show container status and URLs
	$(COMPOSE) ps
	@echo "Frontend: $(APP_URL)"
	@echo "Backend:  $(API_URL)"

.PHONY: shell
shell: ## Open a shell in a container (SERVICE=backend|frontend, default backend)
	$(COMPOSE) exec $(or $(SERVICE),backend) /bin/sh

.PHONY: clean
clean: ## Stop containers and remove volumes (asks first)
	@read -p "Remove containers and volumes (cargo build cache)? [y/N] " r; \
	if [[ $$r =~ ^[Yy]$$ ]]; then $(COMPOSE) down -v --remove-orphans; else echo Cancelled.; fi

.PHONY: open
open: ## Open the app in the browser
	@open "$(APP_URL)" 2>/dev/null || xdg-open "$(APP_URL)"

.PHONY: wait
wait: ## Wait until backend and frontend respond (first cargo build can take minutes)
	@printf "Waiting for backend"; \
	for i in $$(seq 1 600); do curl -sf "$(API_URL)/health" >/dev/null && break; printf .; sleep 1; done; echo; \
	printf "Waiting for frontend"; \
	for i in $$(seq 1 120); do curl -sf -o /dev/null "$(APP_URL)" && break; printf .; sleep 1; done; echo

.PHONY: reset-ports
reset-ports: ## Forget the saved ports; the next `make up` picks new ones
	rm -f $(PORTS_FILE)

$(PORTS_FILE):
	@printf 'BACKEND_PORT ?= %s\nFRONTEND_PORT ?= %s\n' "$(BACKEND_PORT)" "$(FRONTEND_PORT)" > $@
	@echo "Using ports backend=$(BACKEND_PORT) frontend=$(FRONTEND_PORT) (saved to $@)"

.env:
	@echo "Missing .env in the project root (see backend/.env.example)"; exit 1

##@ Local (no Docker)

.PHONY: dev-backend
dev-backend: ## Run the backend on the host (port 8877)
	cd backend && cargo run

.PHONY: dev-frontend
dev-frontend: ## Run the frontend on the host (port 8878)
	cd frontend && bun run dev

.PHONY: test
test: ## Run all tests
	./test

.PHONY: check
check: ## Typecheck the frontend and lint the backend
	cd frontend && bun run check
	cd backend && cargo clippy --all-targets -- -D warnings

##@ Help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"} /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)} \
	  /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
