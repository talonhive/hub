# Security policy

Please report vulnerabilities privately: **Security → Report a vulnerability** on this repository. Don't open
public issues for security problems.

Most wanted: ways to fake activity (steps, game moves) that pass our checks, anything that could leak motion data
off the device, and any flaw in how the app handles wallet connection or Mining Keys once mining is enabled.

## What this project never does

- Never asks for seed phrases, passwords or wallet keys. Mining uses revocable **Mining Keys** via the official
  Acki Nacki Wallet flow.
- Never collects location. Motion sensor data is processed on the device and never sent.
- Never stores secrets in the repo: `.gitignore`, `tools/hooks/pre-commit`, and a CI gitleaks scan on every push.
  The APK signing key lives only in GitHub's encrypted secrets.

**Only install TalonHive Hub from this repository's GitHub Releases.** Any other download is not from us.
