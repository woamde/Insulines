FROM node:24-bookworm-slim AS web
WORKDIR /build/frontend
RUN npm install --global --force yarn@1.22.22
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile --ignore-scripts --non-interactive
COPY frontend/ ./
RUN node scripts/export-local-web.mjs

FROM python:3.11-slim-bookworm AS app
WORKDIR /opt/glycosoin/backend
COPY backend/requirements.txt ./
# This is a COMPLETE pip-freeze lock, including transitive dependencies. The
# managed package refers to the same LiteLLM wheel without its checksum fragment,
# which pip's resolver incorrectly treats as a different direct-URL requirement.
# Install the exact locked artifacts (keeping checksum validation), then verify
# every declared dependency. Missing/incompatible dependencies fail the build.
RUN pip install --no-cache-dir --no-deps --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/ -r requirements.txt \
    && pip check
COPY backend/ ./
COPY --from=web /build/frontend/dist /opt/glycosoin/web
RUN useradd --uid 10001 --create-home glycosoin
USER glycosoin
ENV PYTHONUNBUFFERED=1 WEB_DIST_DIR=/opt/glycosoin/web
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port \"$PORT\" --workers 1"]