# Development and CI container for Cookframe (CFV1-SL0, ADR-0001).
#
# It is the same shape an operator runs (PDR-0002: self-hosted, single-user):
# Node 22 with the project's dependencies installed, running the documented
# commands a contributor runs locally. It carries no secrets — configuration
# arrives through the environment at run time (see .env.example, SECURITY.md).
FROM node:22-slim

WORKDIR /app

# Install dependencies from the lockfile first so this layer caches across
# source changes.
COPY package.json package-lock.json ./
RUN npm ci

# Then the source.
COPY . .

# Default to the full quality gate — the same checks CI runs.
CMD ["npm", "run", "quality"]
