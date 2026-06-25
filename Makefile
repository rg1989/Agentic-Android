# Agentic Android — simple commands. Run `make` to list them.
.DEFAULT_GOAL := help
.PHONY: help start claude stop restart install open logs

help:
	@echo "Agentic Android:"
	@echo "  make start     start the stack (relay + hub + basic agent) + phone tunnel"
	@echo "  make claude    start the stack using YOUR Claude (run 'claude login' once first)"
	@echo "  make stop      stop the stack"
	@echo "  make restart   restart the stack"
	@echo "  make install   build the app + (re)install on the connected phone"
	@echo "  make open      open the setup page (http://127.0.0.1:8123) in your browser"
	@echo "  make logs      tail the stack logs"

start:
	@./start.sh

claude:
	@./start.sh claude

stop:
	@./stop.sh

restart:
	@./stop.sh; ./start.sh

install:
	@./install-phone.sh

open:
	@open http://127.0.0.1:8123

logs:
	@tail -n 30 -f .logs/*.log 2>/dev/null || echo "no logs yet — run 'make start' first"
