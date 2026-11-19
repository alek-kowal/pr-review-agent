# Deploy

`compose.yaml` runs the app on one VM: `web` (Caddy, the SPA and a proxy to the api), `api` and
`worker`. Run every command from this folder or pass `-f deploy/compose.yaml`.

## Files

- `app.env` (never committed): the app env, written by the secret store. Names in
  `app.env.example`. Only `api`, `worker` and `migrate` read it; `web` gets no env.
- `GITHUB_APP_PRIVATE_KEY_FILE` (shell or `deploy/.env`): host path of the GitHub App key. It is
  mounted read-only at `/run/secrets/github_app_key`, and `GITHUB_APP_PRIVATE_KEY_PATH` points
  there. Without it the GitHub integration reports itself not configured. Compose mounts the file
  with its host owner and mode, and api and worker run as uid 1000 (`node`), so the key must be
  readable by that uid (for example `chown 1000 key.pem && chmod 400 key.pem`); an unreadable key
  also reads as not configured.
- `local.env`: non-secret values for the `local` rehearsal below.

Other variables: `PRA_ENV_FILE` (default `app.env`), `PRA_WEB_PORT` (default `8080`, bound to
`127.0.0.1`; TLS and the gate sit in front, F-04-T7), `PRA_IMAGE_PREFIX` and `PRA_TAG` (image
names, default `pra-<app>:latest`).

## Deploy or upgrade

```sh
docker compose build                 # or pull the images
docker compose run --rm migrate      # migrations never run on start
docker compose up -d
```

The worker restarts until the first migration has run.

## Rehearse on a laptop

The `local` profile adds Postgres 17 and MinIO (bucket `pra`). Use your own project name and a
free port so it does not clash with other stacks:

```sh
export PRA_ENV_FILE=local.env PRA_WEB_PORT=8080
docker compose -p pra-rehearsal --profile local up -d --build
docker compose -p pra-rehearsal --profile local run --rm migrate
curl localhost:8080/health          # 200 through the web proxy
curl localhost:8080/prs             # the SPA
docker compose -p pra-rehearsal --profile local down -v
```
