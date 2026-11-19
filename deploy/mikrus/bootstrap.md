# Bootstrap the Mikrus VPS

One-time setup of a fresh Mikrus VPS (Ubuntu 24.04, Docker and nginx already there) as `root`.
After it, every release is one `deploy/mikrus/deploy.sh` from your machine. Why it looks like
this: [docs/deploy-mikrus.md](../../docs/deploy-mikrus.md).

Layout on the server:

| Path                             | What                                                     | Owner          |
| -------------------------------- | -------------------------------------------------------- | -------------- |
| `/srv/pra/repo.git`              | Bare repository `deploy.sh` pushes to                    | `pra`          |
| `/srv/pra/app`                   | Checkout of the deployed commit, with its build          | `pra`          |
| `/srv/pra/web/current`           | Link to the live SPA build (`web/releases/<commit>`)     | `pra`          |
| `/var/lib/pra/data`, `.../blobs` | `DATA_DIR` (mirrors, worktrees, caches), `BLOB_DIR`      | `pra`          |
| `/var/backups/pra`               | Nightly database dumps                                   | `pra`          |
| `/etc/pra/pra.env`               | App settings and secrets (names: `pra.env.example`)      | `root:pra 640` |
| `/etc/pra/db.env`                | `POSTGRES_PASSWORD=...` for the Compose Postgres         | `root 600`     |
| `/etc/systemd/system/pra-*`      | Copies of `deploy/mikrus/systemd/*` (root-owned, copied) | `root`         |

## 1. Packages and the `pra` user

```sh
apt-get update && apt-get install -y git curl ca-certificates apache2-utils gettext-base
# Node 24 (the version in the root package.json `engines`); pnpm comes from corepack.
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs
corepack enable

useradd --system --create-home --home-dir /srv/pra --shell /bin/bash pra
usermod -aG docker pra    # for `pnpm sandbox:bench` by hand; the units add the group themselves
install -d -o pra -g pra -m 750 /srv/pra/web /srv/pra/web/releases /var/lib/pra \
  /var/lib/pra/data /var/lib/pra/blobs
install -d -o pra -g pra -m 700 /var/backups/pra
install -d -o root -g pra -m 750 /etc/pra

# Your deploy key (the public half of PRA_DEPLOY_KEY on your machine).
install -d -o pra -g pra -m 700 /srv/pra/.ssh
cat >> /srv/pra/.ssh/authorized_keys    # paste the public key, then Ctrl-D
chown pra:pra /srv/pra/.ssh/authorized_keys && chmod 600 /srv/pra/.ssh/authorized_keys

# Logs stay small on a 27 GB disk.
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\n' > /etc/systemd/journald.conf.d/pra.conf
systemctl restart systemd-journald
```

## 2. Repository and first checkout

```sh
sudo -u pra git init --bare /srv/pra/repo.git
sudo -u pra git clone --quiet /srv/pra/repo.git /srv/pra/app
```

From your machine, push the code once (the full deploy comes in step 7):

```sh
git push ssh://pra@<host>:<port>/srv/pra/repo.git HEAD:refs/heads/deploy
```

Back on the server:

```sh
sudo -u pra git -C /srv/pra/app fetch --quiet origin
sudo -u pra git -C /srv/pra/app checkout --quiet --detach origin/deploy
```

## 3. Secrets

```sh
umask 077
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" > /etc/pra/db.env
cp /srv/pra/app/deploy/mikrus/pra.env.example /etc/pra/pra.env
chown root:pra /etc/pra/pra.env && chmod 640 /etc/pra/pra.env
# The GitHub App's private key: /etc/pra/github-app.pem, root:pra, 640.
# Fill /etc/pra/pra.env: DATABASE_URL with the password above and host 127.0.0.1,
# DATA_DIR=/var/lib/pra/data, BLOB_DIR=/var/lib/pra/blobs, APP_BASE_URL,
# CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token` on your machine), the GitHub App values,
# and SANDBOX_RUNTIME=runc (gVisor cannot run in Mikrus's unprivileged LXC; do not install it).
sudo -u pra ln -s /etc/pra/pra.env /srv/pra/app/.env
```

## 4. Postgres and the sandbox image

```sh
docker compose -f /srv/pra/app/deploy/mikrus/compose.yaml up -d
docker pull node:24-slim
```

## 5. systemd units

Copy, never link: `pra` owns the checkout, and `pra-restart@` runs as root.

```sh
cp /srv/pra/app/deploy/mikrus/systemd/* /etc/systemd/system/
systemctl daemon-reload
systemctl enable pra-api.service pra-worker.service
systemctl enable --now pra-backup.timer pra-cleanup.timer \
  pra-health@api.timer pra-health@worker.timer

# deploy.sh restarts the two services as pra, and nothing else.
echo 'pra ALL=(root) NOPASSWD: /usr/bin/systemctl restart pra-api.service pra-worker.service' \
  > /etc/sudoers.d/pra
chmod 440 /etc/sudoers.d/pra && visudo -cf /etc/sudoers.d/pra
```

Repeat the `cp` and `daemon-reload` when a release changes `deploy/mikrus/systemd/`.

## 6. nginx and the access gate

```sh
htpasswd -c /etc/nginx/pra.htpasswd <login>    # asks for the gate password
chown root:www-data /etc/nginx/pra.htpasswd && chmod 640 /etc/nginx/pra.htpasswd
PRA_SERVER_NAME=<subdomain>.mikrus.dev envsubst '${PRA_SERVER_NAME}' \
  < /srv/pra/app/deploy/mikrus/nginx/pra.conf.template > /etc/nginx/sites-available/pra.conf
ln -sf /etc/nginx/sites-available/pra.conf /etc/nginx/sites-enabled/pra.conf
nginx -t && systemctl reload nginx
```

In the Mikrus panel, point the subdomain at port 80 of this VPS.

## 7. First deploy and checks

From your machine, with `deploy/mikrus/deploy.env` filled (`deploy.env.example`):

```sh
deploy/mikrus/deploy.sh --dry-run    # prints the push and the remote command
deploy/mikrus/deploy.sh
```

Then:

- `https://<subdomain>.mikrus.dev/` asks for the gate login and shows the app.
- `curl -i https://<subdomain>.mikrus.dev/webhooks/github` answers from the api (not 401).
- In the GitHub App settings, set the webhook URL to `https://<subdomain>.mikrus.dev/webhooks/github`.
- `systemctl list-timers 'pra-*'` lists four timers; `journalctl -u pra-worker -n 50` is quiet.
- Size the sandbox on the real repository (docs/deploy-mikrus.md, "Measure"):
  `sudo -iu pra sh -c 'cd app && pnpm sandbox:bench --repo <git url> --slug <slug>'`.
