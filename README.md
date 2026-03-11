# WebSocket / HTTP Demo — Reverse Proxy SSL Termination Tester

A minimal demo app for testing **HTTP** and **WebSocket** connections both plain (`http`/`ws`) and TLS-terminated (`https`/`wss`) through an nginx reverse proxy.

Useful for validating reverse proxy setups, Kubernetes ingress controllers, and TLS termination for WebSocket upgrades.

---

## Architecture

```
Browser
  │
  ├─ https://...  (443)  ─┐
  └─ wss://...    (443)  ─┤  nginx (SSL termination)
                           │      ↓ plain http/ws
                           └──► app:3000  (Node.js)
```

The app server speaks **plain HTTP + WS only**. TLS is always handled by the proxy layer (nginx or k8s ingress). The browser UI lets you toggle between `ws://` and `wss://` so you can test both paths.

---

## Server Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check — returns `{status:"ok", time}` |
| GET | `/api/ping` | HTTP ping — returns `{message:"pong", time}` |
| WS | `/ws` | WebSocket endpoint |

**WebSocket behaviour:**
- On connect: server sends a `welcome` message with an assigned `clientId`
- Every 5 seconds: server sends a `ping` message
- Any message sent by the client is echoed back as an `echo` message

---

## Docker Compose

### Prerequisites

- Docker + Docker Compose v2
- `openssl` (for cert generation)

### 1. Generate a self-signed certificate

```bash
./generate-certs.sh
```

This writes `nginx/certs/cert.pem` and `nginx/certs/key.pem`. The cert covers `localhost` and `127.0.0.1` and is valid for 10 years.

> **Browser warning:** Self-signed certs will trigger a browser security warning. Click "Advanced → Proceed" (Chrome) or "Accept the risk" (Firefox) to continue.

### 2. Start

```bash
docker compose up --build
```

### 3. Access points

| URL | What it tests |
|-----|---------------|
| `https://localhost` | UI over HTTPS via nginx |
| `wss://localhost/ws` | WSS — TLS terminated by nginx, plain WS to app |
| `http://localhost:3000` | Plain HTTP directly to app (bypasses nginx) |
| `ws://localhost:3000/ws` | Plain WS directly to app (bypasses nginx) |

### 4. Switching ws / wss in the UI

The UI auto-selects `wss` when loaded over HTTPS and `ws` otherwise. You can override it manually:

- **Test `wss://`** — open `https://localhost`, scheme is pre-set to `wss`
- **Test `ws://`** — open `http://localhost:3000` via a plain HTTP workaround, or manually change the scheme dropdown to `ws` and set host to `localhost:3000`

### 5. Stop

```bash
docker compose down
```

---

## Kubernetes

### Prerequisites

- A running cluster (e.g. minikube, kind, k3s, EKS, GKE)
- `kubectl` configured
- An ingress controller installed (nginx ingress recommended)
- `openssl` for cert generation (or bring your own cert / cert-manager)

### Option A — Self-signed cert (local clusters)

#### 1. Generate cert and create a TLS Secret

```bash
# Generate cert
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout tls.key -out tls.crt \
  -subj "/CN=ws-demo.local" \
  -addext "subjectAltName=DNS:ws-demo.local"

# Create secret in the target namespace
kubectl create secret tls ws-demo-tls --cert=tls.crt --key=tls.key
```

#### 2. Apply manifests

```bash
kubectl apply -f k8s/
```

#### 3. Add a hosts entry (local only)

```bash
# Get ingress IP
kubectl get ingress ws-demo-ingress

# Add to /etc/hosts
echo "127.0.0.1 ws-demo.local" | sudo tee -a /etc/hosts
```

For minikube use `minikube ip` instead of `127.0.0.1`.

### Option B — cert-manager (production / staging)

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

# Create a ClusterIssuer (Let's Encrypt staging)
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: your@email.com
    privateKeySecretRef:
      name: letsencrypt-staging
    solvers:
      - http01:
          ingress:
            class: nginx
EOF
```

Then update the Ingress annotation to `cert-manager.io/cluster-issuer: letsencrypt-staging` and remove the manually created TLS secret.

### Kubernetes manifests

Create a `k8s/` directory with the following files:

**`k8s/deployment.yaml`**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ws-demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ws-demo
  template:
    metadata:
      labels:
        app: ws-demo
    spec:
      containers:
        - name: app
          image: gsrrelease/ws_test
          ports:
            - containerPort: 3000
          env:
            - name: PORT
              value: "3000"
```

**`k8s/service.yaml`**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: ws-demo
spec:
  selector:
    app: ws-demo
  ports:
    - port: 3000
      targetPort: 3000
```

**`k8s/ingress.yaml`**
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ws-demo-ingress
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    # Required for WebSocket upgrade
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "Upgrade";
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - ws-demo.local
      secretName: ws-demo-tls   # created in step A.1 or by cert-manager
  rules:
    - host: ws-demo.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ws-demo
                port:
                  number: 3000
```

> **Note:** The `proxy-read-timeout` annotation is critical for WebSocket connections. Without it, the ingress controller will close idle WebSocket connections after 60 seconds.

### Kubernetes access points

| URL | What it tests |
|-----|---------------|
| `https://ws-demo.local` | UI over HTTPS via ingress |
| `wss://ws-demo.local/ws` | WSS — TLS terminated by ingress, plain WS to pod |
| `http://ws-demo.local` | Redirects to HTTPS (ingress default) |

To test `ws://` (plain, no TLS) from inside the cluster:

```bash
# Port-forward directly to the pod
kubectl port-forward deployment/ws-demo 3000:3000

# Then use ws://localhost:3000/ws in the UI
```

---

## Testing with curl and wscat

**HTTP:**
```bash
# Through nginx (HTTPS)
curl -k https://localhost/health
curl -k https://localhost/api/ping

# Direct to app (plain HTTP)
curl http://localhost:3000/health
```

**WebSocket (plain):**
```bash
# Install wscat
npm install -g wscat

# Plain WS directly to app
wscat -c ws://localhost:3000/ws

# WSS through nginx (skip cert verification for self-signed)
wscat -c wss://localhost/ws --no-check
```

**WebSocket via curl (connection upgrade check):**
```bash
curl -k -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  https://localhost/ws
# Expect: HTTP/1.1 101 Switching Protocols
```

---

## File Structure

```
.
├── docker-compose.yml
├── generate-certs.sh        # self-signed cert generator
├── .gitignore               # excludes nginx/certs/
├── server/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js            # Node.js HTTP + WS server
├── client/
│   └── index.html           # browser test UI
├── nginx/
│   ├── nginx.conf           # reverse proxy + SSL termination config
│   └── certs/               # generated certs (git-ignored)
│       ├── cert.pem
│       └── key.pem
└── k8s/
    ├── deployment.yaml
    ├── service.yaml
    └── ingress.yaml
```

---

## Configuration Reference

### App server environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the Node.js server listens on |

### nginx SSL

| File | Purpose |
|------|---------|
| `nginx/certs/cert.pem` | TLS certificate (PEM) |
| `nginx/certs/key.pem` | TLS private key (PEM) |

To use a real certificate (e.g. from Let's Encrypt), replace these two files and restart nginx:

```bash
docker compose restart nginx
```

### Switching between ws:// and wss:// in the UI

| Scenario | Scheme | Host |
|----------|--------|------|
| Via nginx with TLS | `wss` | `localhost` (or your domain) |
| Direct to app, no TLS | `ws` | `localhost:3000` |
| k8s ingress with TLS | `wss` | `ws-demo.local` (or your domain) |
| k8s port-forward, no TLS | `ws` | `localhost:3000` |

The UI dropdown and host field are fully editable — no rebuild needed.
# ws_ssl_demo
