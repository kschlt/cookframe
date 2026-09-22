# Development and CI container for Cookframe (CFV1-SL0, ADR-0001).
#
# It is the same shape an operator runs (PDR-0002: self-hosted, single-user):
# Node 26 with the project's dependencies installed, running the documented
# commands a contributor runs locally. It carries no secrets — configuration
# arrives through the environment at run time (see .env.example, SECURITY.md).
FROM node:26-slim

WORKDIR /app

# git, because the quality gate needs it — not as a convenience.
#
# `CMD` below is `npm run quality`, and that gate includes the CFV1-BASE proofs
# (`tests/base/`), which build real git repositories and produce real merge
# results. They do that instead of asserting words in a workflow file because
# both incidents CFV1-BASE exists to catch were pairs of changes whose spelling
# was impeccable; nothing short of performing a merge distinguishes them.
#
# `node:26-slim` carries no git, so without this the container job fails with
# `spawnSync git ENOENT` — which is the correct signal and how this line came
# to be here. Do not answer that failure by skipping those proofs when git is
# missing: a skipped proof reports success, and the container job would then
# certify a gate that had silently run eleven checks fewer than the one every
# other job runs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies from the lockfile first so this layer caches across
# source changes.
COPY package.json package-lock.json ./
RUN npm ci

# Then the source.
COPY . .

# Default to the full quality gate — the same checks CI runs.
CMD ["npm", "run", "quality"]
