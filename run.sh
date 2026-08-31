#!/bin/bash
cd "$(dirname "$0")"
.venv/bin/uvicorn webapp.main:app --reload --port 8000
