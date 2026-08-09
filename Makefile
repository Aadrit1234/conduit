# Conduit — build & deployment pipeline.
# `make verify` runs the full CI-equivalent pipeline with the local toolchain
# (no Docker needed). `make images`/`make up`/`make deploy` drive Docker.

SHELL := /bin/bash
REGISTRY ?= ghcr.io/your-org/conduit
TAG ?= latest

.PHONY: help verify test lint build images up down logs psql push deploy

help:
	@echo "Targets:"
	@echo "  verify   run the full pipeline locally: server tests, lint, frontend + backend builds, prod smoke"
	@echo "  test     server integration tests"
	@echo "  lint     frontend eslint"
	@echo "  build    frontend (tsc + vite) and backend (tsc) production builds"
	@echo "  images   docker build both images (frontend, backend)"
	@echo "  up       docker compose up --build -d (frontend :8080, backend :8787, postgres)"
	@echo "  down     docker compose down"
	@echo "  logs     tail compose logs"
	@echo "  push     tag + push images to \$${REGISTRY}"
	@echo "  deploy   pull + up on a remote host via SSH (\$${SSH_HOST}, \$${DEPLOY_DIR})"

verify: test lint build
	./scripts/pipeline.sh --smoke
	@echo "✓ pipeline green"

test:
	cd server && npm test

lint:
	npm run lint

build:
	npm run build
	cd server && npm run build

images:
	docker build -t $(REGISTRY)-frontend:$(TAG) .
	docker build -t $(REGISTRY)-backend:$(TAG) server

up:
	docker compose up --build -d
	@echo "frontend → http://localhost:8080  backend → http://localhost:8787"

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

psql:
	docker compose exec db psql -U conduit -d conduit

push: images
	docker push $(REGISTRY)-frontend:$(TAG)
	docker push $(REGISTRY)-backend:$(TAG)

deploy:
	@test -n "$(SSH_HOST)" || (echo "set SSH_HOST and DEPLOY_DIR"; exit 1)
	ssh $(SSH_HOST) 'cd $(DEPLOY_DIR) && docker compose -f docker-compose.yml -f docker-compose.prod.yml pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d'
