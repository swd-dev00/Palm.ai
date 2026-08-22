# Oracle Always Free deployment guide

**Purpose.** This guide deploys the reconstructed Palm control-plane foundation to an Oracle Cloud Ubuntu VM. It deliberately does **not** represent the application as production-complete: the original archive lacked its production OAuth/session adapter, upload-storage replacement, and original full client component tree. The checked-in Vite client is a minimal operational dashboard that confirms health and runner capabilities.

> **Deploy the health/dashboard MVP now only if a public health endpoint is useful. Do not expose user task APIs to real users until production authentication and storage are restored.**

Oracle’s current Always Free allocation permits a total of **2 OCPUs and 12 GB RAM** for `VM.Standard.A1.Flex` in the tenancy home region. An A1 shape can temporarily be unavailable, and idle Always Free VMs can be reclaimed under Oracle’s documented utilization criteria. [1]

| Decision | Recommended setting | Reason |
| --- | --- | --- |
| Image | Ubuntu 24.04 LTS, ARM64 | Matches the A1 architecture and this service’s Node runtime. |
| Shape | `VM.Standard.A1.Flex`, 1 OCPU / 6 GB RAM | Leaves headroom within the documented free allocation. [1] |
| Public exposure | 80/443 public; 22 only from the administrator’s fixed IP | Keeps the service behind TLS while minimizing SSH exposure. |
| Database | Local MySQL bound to `127.0.0.1` | No public database port is required for the MVP. |
| Process | systemd `palm` service with Nginx reverse proxy | Provides restart-on-failure and TLS termination. |

## 1. Provision the VM and network

In the Oracle Cloud Console, create an instance in the **home region** using an Always Free eligible Ubuntu image, a public subnet, and `VM.Standard.A1.Flex`. Allocate 1 OCPU and 6 GB RAM. Create or retain an SSH key pair and record the instance’s public IPv4 address. A public instance must have a public subnet, public IP, internet gateway, route table, and matching security controls to be internet-reachable. [4]

Use a network security group (preferred) or security list to allow inbound TCP `80` and `443` from `0.0.0.0/0`, and TCP `22` **only from your own fixed public IP/CIDR**. Oracle describes both security lists and network security groups as virtual firewall mechanisms, and recommends network security groups. [3]

```text
Ingress TCP 22   source: your.public.ip.address/32
Ingress TCP 80   source: 0.0.0.0/0
Ingress TCP 443  source: 0.0.0.0/0
```

If Oracle reports “out of host capacity,” do not substitute a paid shape accidentally. Retry in another availability domain or later; Oracle documents that this message reflects temporary capacity exhaustion for the eligible shape. [1]

## 2. Secure the Ubuntu host

SSH to the VM using the Ubuntu account created by the image. Replace `VM_PUBLIC_IP` with the recorded address.

```bash
ssh -i ~/.ssh/oracle-palm.key ubuntu@VM_PUBLIC_IP
sudo apt update && sudo apt -y upgrade
sudo apt install -y ca-certificates curl git build-essential nginx mysql-server ufw certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
```

Configure the host firewall as a second layer. Use your actual administration IP in place of `ADMIN_CIDR`; do not leave SSH open to the entire internet.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from ADMIN_CIDR to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Create a service account and deployment directories.

```bash
sudo useradd --system --create-home --home-dir /srv/palm --shell /usr/sbin/nologin palm
sudo install -d -o palm -g palm -m 0750 /srv/palm /var/log/palm /etc/palm
```

## 3. Install and build Palm

Use a deploy key, a read-only repository token, or an authenticated SSH configuration for the repository; do not paste a personal access token into the shell history. Clone the repository and install the dependencies.

```bash
sudo -u palm git clone git@github.com:swd-dev00/Palm.ai.git /srv/palm/Palm.ai
cd /srv/palm/Palm.ai
sudo -u palm pnpm install
sudo -u palm pnpm build
```

The build must create `dist/index.js` and `dist/index.html`. The production server serves the bundled client from that same `dist` directory.

```bash
test -f dist/index.js && test -f dist/index.html && echo "Palm build is present"
```

## 4. Create the local MySQL database

Keep MySQL local-only. Create a dedicated database and a dedicated account with a generated password.

```bash
sudo mysql
```

```sql
CREATE DATABASE palm_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'palm'@'localhost' IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_DATABASE_PASSWORD';
GRANT ALL PRIVILEGES ON palm_ai.* TO 'palm'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Copy the environment template and populate it with actual random values. The example includes every currently recognized runtime variable, while intentionally leaving the unavailable production OAuth and Forge storage integrations disabled.

```bash
sudo install -m 0600 -o root -g palm /srv/palm/Palm.ai/.env.example /etc/palm/palm.env
sudoedit /etc/palm/palm.env
openssl rand -base64 48
openssl rand -base64 48
```

Set `DATABASE_URL`, `JWT_SECRET`, and `GITHUB_ACTIONS_RUNNER_SHARED_SECRET` in `/etc/palm/palm.env`. Do **not** set `PALM_DEV_OPEN_ID` in production. Do **not** commit or upload the completed environment file.

The checked-in schema can be generated and applied for an initial database only after `DATABASE_URL` is valid. Review the generated migration before applying it, particularly on any non-empty database.

```bash
sudo bash -c 'set -a; . /etc/palm/palm.env; set +a; cd /srv/palm/Palm.ai && pnpm drizzle-kit generate'
sudo bash -c 'set -a; . /etc/palm/palm.env; set +a; cd /srv/palm/Palm.ai && pnpm drizzle-kit migrate'
```

## 5. Install the service and reverse proxy

Replace `palm.example.com` in the Nginx template with a domain that you control. Point its DNS `A` record to the VM public IP **before** requesting the certificate.

```bash
sudo cp /srv/palm/Palm.ai/deploy/systemd/palm.service /etc/systemd/system/palm.service
sudo sed 's/palm.example.com/YOUR_DOMAIN/g' /srv/palm/Palm.ai/deploy/nginx/palm.conf | sudo tee /etc/nginx/sites-available/palm >/dev/null
sudo ln -sf /etc/nginx/sites-available/palm /etc/nginx/sites-enabled/palm
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now palm
sudo systemctl enable --now nginx
curl -fsS http://127.0.0.1:3000/healthz
```

Then obtain TLS through Certbot.

```bash
sudo certbot --nginx -d YOUR_DOMAIN --redirect --agree-tos -m YOUR_EMAIL
curl -fsS https://YOUR_DOMAIN/healthz
```

A successful health response is:

```json
{"status":"ok","service":"palm-control-plane"}
```

## 6. Configure GitHub Actions only after HTTPS is live

Once `https://YOUR_DOMAIN/healthz` succeeds, configure repository secrets. The worker needs a publicly reachable HTTPS base URL and the exact same runner shared secret held by the server.

| Repository secret | Value |
| --- | --- |
| `PALM_BASE_URL` | `https://YOUR_DOMAIN` |
| `PALM_RUNNER_SHARED_SECRET` | Exact value of `GITHUB_ACTIONS_RUNNER_SHARED_SECRET` in `/etc/palm/palm.env` |

Do not set placeholder values. Test the Actions workflow first with `run_mode=validate`; the repository’s last recorded manual validation attempt was blocked **before workflow steps** by a GitHub account billing lock. That account issue must be resolved before hosted execution can be verified.

The server additionally needs a **separate**, least-privilege GitHub token in `GITHUB_ACTIONS_DISPATCH_TOKEN` with the ability to dispatch the repository workflow. It is not a GitHub Actions repository secret. Rotate any token previously shared in chat and never commit it.

## 7. Update and recover safely

For an ordinary source update, build first, then restart only after the build succeeds.

```bash
cd /srv/palm/Palm.ai
sudo -u palm git pull --ff-only
sudo -u palm pnpm install
sudo -u palm pnpm build
sudo systemctl restart palm
sudo systemctl status palm --no-pager
curl -fsS https://YOUR_DOMAIN/healthz
```

Use `journalctl` for diagnosis.

```bash
sudo journalctl -u palm -n 100 --no-pager
sudo journalctl -u palm -f
```

## Current deployment boundary

| Capability | Status in this repository | Required before public multi-user use |
| --- | --- | --- |
| API health and static client serving | Reconstructed and smoke-tested | Domain/TLS and normal host hardening only. |
| GitHub Actions workflow definition | Present | Resolve GitHub billing lock; set real secrets after HTTPS deployment. |
| GitHub hosted worker dispatch | Implemented in source | Public endpoint, shared secret, database, dispatch token, and successful Actions capacity. |
| Local Runner and Local Browser Runner paths | Retained in source | Restore the original authenticated workspace UI and production session handling. |
| User authentication | **Not restored** | Integrate and test a real OAuth/session adapter with secure cookies. |
| Cloud attachment storage | **Not restored for Oracle** | Replace the legacy Forge storage dependency with an Oracle-compatible object storage adapter or another secure storage service. |
| Original full UI | **Not restored** | Port the missing component primitives and authenticated workspace modules. |

## References

[1]: https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm "Oracle Cloud Infrastructure: Always Free Resources"
[2]: https://docs.oracle.com/iaas/Content/FreeTier/freetier.htm "Oracle Cloud Infrastructure: Free Tier"
[3]: https://docs.oracle.com/iaas/Content/Network/Concepts/securitylists.htm "Oracle Cloud Infrastructure: Security Lists"
[4]: https://docs.oracle.com/iaas/Content/Network/Tasks/managingpublicIPs.htm "Oracle Cloud Infrastructure: Public IP Addresses"
