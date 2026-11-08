# Bee Engine SDK 6.0.0 + community patches (built by TalonHive Hub)

This is GOSH's Bee Engine SDK v6.0.0 (github.com/gosh-sh/bee-engine, commit 015bc46) with four community patches
that make mining work on a busy mainnet: a refused round summary or proof is resent (the same signed message)
until it is delivered, messages live 240 s, the go-ahead is read from the chain if its event is missing, and
the next round is mined while one is delivered (premine).

- How it was built, and the patches: `tools/bee-sdk/` in this repository (the Corresponding Source, with
  credits to goblingames and NeoRider, and TalonHive's review)
- Built by: `.github/workflows/bee-sdk.yml`, run 42390974234, published as pre-release `bee-sdk-6.0.0-ng.1`;
  see `BUILDINFO.txt`
- Checksums: `SHA256SUMS.txt` (bee_sdk.js, bee_sdk_bg.wasm), verified when vendored on 2026-11-08
- Licence: GNU AGPL-3.0 (`LICENSE.md`, `NOTICE.md`), like the Hub itself
