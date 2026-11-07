# Bee Engine SDK build (GOSH v6.0.0 + community patches)

TalonHive Hub mines with GOSH's Bee Engine SDK. On a busy mainnet the stock SDK loses rounds: a round summary
refused with "Message queue is full" is never resent, and messages expire after 40 s while they can wait
longer than that in the node's queue. These community patches fix that inside the SDK.

| Patch | Author | What it does |
|---|---|---|
| `0001-newgoblin-delivery-and-diagnostics.patch` | goblingames (NewGoblin) | Round summary (`setCommitData`) and proof (`acceptTap`) are signed once and the **same** message is resent until it is accepted, seen on chain, or a deadline passes (`DUPLICATE_MESSAGE` = already delivered); messages live 240 s; the go-ahead interval is read from the chain if its event is missing; leftover rounds are cancelled the same way; diagnostic callbacks. |
| `0002-newgoblin-premine.patch` | goblingames (NewGoblin) | While one round is being delivered, the next is mined and sent once the first is through. |
| `0003-newgoblin-premine-chain-wait.patch` | goblingames (NewGoblin) | Premine waits when the chain read is one seed rotation behind. |
| `0004-neorider-polling-difficulty-benchmark.patch` | NeoRider | Event polling every 2.5 s only while a round runs (else 10 s), 25 instead of 100 events; difficulty in `get_miner_data`; `benchmark_hashes`. |

Sources: the four patches and `Cargo.lock` are copied unchanged from NeoRider's Nackl Digger
(github.com/NeoRider12/Nackl-Digger, folder `bee-engine/`), which takes 0001–0003 and the `Cargo.lock` from
goblingames (github.com/andresCadavidT/goblingames, `source/bee-sdk-6.0.0-ng.3`). `SHA256SUMS.txt` records
each file; the build checks them.

## Review (TalonHive, 2026-11-07)

Read in full before use. Signatures go only to the user's own miner contract, for the same three functions as
the stock SDK (`setCommitData`, `acceptTap`, `cancelCommitData`), through GOSH's own `ackinacki-kit` v6.1.0
delivery API (`PreparedMessage::send_once`). No new hosts, network code or dependencies; the Mining Keys are
used only for signing and never appear in callbacks (the Hub writes callbacks into its support log). Every
`Cargo.lock` source is crates.io or a GOSH / TVM Labs / well-known cryptography repository.

## Build

`.github/workflows/bee-sdk.yml`: GOSH bee-engine tag `v6.0.0` (commit
`015bc466613e7b7c41f272dc16ba0cacbf0e4d93`, checked), the patches in file-name order, this `Cargo.lock`, then
GOSH's `scripts/build_wasm.sh sdk`. The result (`bee_sdk.js`, `bee_sdk_bg.wasm`, `BUILDINFO.txt`,
`SHA256SUMS.txt`) is published as a pre-release named `bee-sdk-6.0.0-ng.<run>` and vendored in
`www/vendor/bee-sdk-6.0.0-ng/`.

## Licence

Bee Engine © 2026 GOSH TECHNOLOGY LTD, GNU AGPL-3.0. Patches 0001–0003 by the author of goblingames, 0004
© 2026 NeoRider, under the same licence. This folder plus the upstream tag is the Corresponding Source of the
SDK the Hub ships; the Hub itself is AGPL-3.0 too.
