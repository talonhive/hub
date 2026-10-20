#!/usr/bin/env bash
# Creates the TalonHive Hub Android release signing key. Run it ONCE, yourself, in Git Bash:
#     bash tools/make-signing-key.sh
# - The key is saved OUTSIDE the repo, in ~/talonhive-signing/ (never commit it, never share it).
# - Back up ~/talonhive-signing/talonhive-release.p12 and its password somewhere safe and offline:
#   every future update must be signed with this same key, or phones will refuse to update the app.
# - It prints the text you paste into the GitHub secret ANDROID_KEYSTORE_B64 (into GitHub only).
set -euo pipefail

dir="$HOME/talonhive-signing"
p12="$dir/talonhive-release.p12"
if [ -e "$p12" ]; then echo "A key already exists at $p12 - not overwriting it."; exit 1; fi
mkdir -p "$dir"; chmod 700 "$dir" 2>/dev/null || true

read -r -s -p "Choose a strong password for the signing key (input hidden): " P1; echo
read -r -s -p "Type it again: " P2; echo
[ "$P1" = "$P2" ] || { echo "Passwords don't match."; exit 1; }
[ ${#P1} -ge 12 ] || { echo "Use at least 12 characters."; exit 1; }
export TH_KS_PASS="$P1"; unset P1 P2

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# RSA 4096 key + self-signed certificate valid for 30 years (Android requires validity beyond 2033).
# The certificate name goes in a small config file (a "/CN=..." argument gets mangled by Git Bash on Windows).
printf '[req]\nprompt = no\ndistinguished_name = dn\n[dn]\nCN = TalonHive\nO = TalonHive\n' > "$tmp/req.cnf"
openssl req -x509 -newkey rsa:4096 -sha256 -days 10950 -nodes -config "$tmp/req.cnf" \
  -keyout "$tmp/key.pem" -out "$tmp/cert.pem" >/dev/null 2>&1 || { echo "Key creation failed."; exit 1; }
openssl pkcs12 -export -name talonhive -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
  -out "$p12" -passout env:TH_KS_PASS
chmod 600 "$p12" 2>/dev/null || true
unset TH_KS_PASS

echo
echo "Saved: $p12"
echo "Key alias (secret ANDROID_KEY_ALIAS): talonhive"
echo "Certificate fingerprint (SHA-256), safe to share so people can verify releases:"
openssl x509 -in "$tmp/cert.pem" -noout -fingerprint -sha256
base64 -w0 "$p12" > "$dir/keystore-base64.txt" 2>/dev/null || base64 "$p12" | tr -d '\n' > "$dir/keystore-base64.txt"
echo
echo "The value for the secret ANDROID_KEYSTORE_B64 is in: $dir/keystore-base64.txt"
echo "Open it, copy everything, paste it into GitHub, then you may delete that .txt file (keep the .p12 backup)."
