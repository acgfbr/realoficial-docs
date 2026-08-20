

start:
	docker-compose up --build

openapi:
	node scripts/generate-openapi.mjs > openapi.json

validate:
	mintlify validate
