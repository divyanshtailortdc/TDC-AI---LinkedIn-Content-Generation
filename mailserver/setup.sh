#!/usr/bin/env bash
# One-time setup of the inbound mail server (see README.md):
#   1. the catch-all rule for the identity domain,
#   2. a self-signed TLS certificate (local only; production uses Let's Encrypt),
#   3. the mailbox the app reads, then starts the server.
#
# Usage: ./setup.sh <inbound-domain> [--production]
#   ./setup.sh in.tdc.test                       local
#   MAIL_HOSTNAME=mail.example.com ./setup.sh in.example.com --production
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${1:?usage: ./setup.sh <inbound-domain, e.g. in.tdc.test> [--production]}"
MODE="${2:-local}"
HOST="${MAIL_HOSTNAME:-mail.tdc.test}"
MAILBOX="catchall@${DOMAIN}"
# Outside the repository: it holds mail and secrets (see compose.yaml).
export MAIL_DATA_DIR="${MAIL_DATA_DIR:-$HOME/.tdc-mailserver}"
CONFIG="${MAIL_DATA_DIR}/config"
COMPOSE=(docker compose -f compose.yaml)
[[ "$MODE" == "--production" ]] && COMPOSE+=(-f compose.prod.yaml)
export MAIL_HOSTNAME="$HOST"

mkdir -p "$CONFIG"

# 1. Every address at the domain goes to the one mailbox, with the address it
# was sent to kept as its detail (catchall+<local part>). Dovecot records that
# in the Delivered-To header, which is how the app knows the identity. The
# first rule maps the mailbox to itself, which ends the rewriting.
escaped="${DOMAIN//./\\.}"
cat > "$CONFIG/postfix-regexp.cf" <<EOF
/^(catchall(\\+[^@]*)?@${escaped})\$/ \${1}
/^([^@+]+)@${escaped}\$/ catchall+\${1}@${DOMAIN}
EOF

# One recipient per delivery to Dovecot: it adds Delivered-To only when a
# delivery has a single recipient, so an email sent to several identities at
# once would otherwise arrive without it, and with no way to route it.
cat > "$CONFIG/postfix-main.cf" <<'EOF'
lmtp_destination_recipient_limit = 1
EOF

# 2. Local only: a CA and a certificate for HOST (and localhost, which the app
# connects to locally), as SSL_TYPE=self-signed expects.
if [[ "$MODE" != "--production" && ! -f "$CONFIG/ssl/${HOST}-cert.pem" ]]; then
  mkdir -p "$CONFIG/ssl/demoCA"
  (
    cd "$CONFIG/ssl"
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=TDC Local Mail CA" \
      -keyout demoCA/cakey.pem -out demoCA/cacert.pem 2>/dev/null
    openssl req -newkey rsa:2048 -nodes -subj "/CN=${HOST}" \
      -keyout "${HOST}-key.pem" -out leaf.csr 2>/dev/null
    openssl x509 -req -in leaf.csr -CA demoCA/cacert.pem -CAkey demoCA/cakey.pem \
      -CAcreateserial -days 3650 -out "${HOST}-cert.pem" \
      -extfile <(printf 'subjectAltName=DNS:%s,DNS:localhost' "$HOST") 2>/dev/null
    rm -f leaf.csr
  )
  echo "Created a self-signed certificate for ${HOST}."
fi

# 3. Start the server and add the mailbox. DMS waits for a first account
# before it starts Dovecot, so it is added once the container is up.
"${COMPOSE[@]}" up -d
if docker exec tdc-mailserver setup email list 2>/dev/null | grep -q "$MAILBOX"; then
  echo "Mailbox ${MAILBOX} already exists; its password is unchanged."
  exit 0
fi
PASSWORD="$(openssl rand -base64 24)"
docker exec tdc-mailserver setup email add "$MAILBOX" "$PASSWORD"

if [[ "$MODE" == "--production" ]]; then
  CONNECTION="MAIL_IMAP_HOST=\"${HOST}\"
MAIL_IMAP_PORT=\"993\""
else
  CONNECTION="MAIL_IMAP_HOST=\"localhost\"
MAIL_IMAP_PORT=\"9993\"
MAIL_IMAP_TLS_CA_FILE=\"${CONFIG}/ssl/demoCA/cacert.pem\""
fi

cat <<EOF

Mail server is starting. Give the app these settings (.env):

INBOUND_EMAIL_DOMAIN="${DOMAIN}"
${CONNECTION}
MAIL_IMAP_USER="${MAILBOX}"
MAIL_IMAP_PASSWORD="${PASSWORD}"

The password is shown only now. Change it with:
  docker exec tdc-mailserver setup email update ${MAILBOX} '<new password>'
EOF
