# 0012 — Firmware targets are adapters behind fixed contracts

**Status:** Proposed, 2026-09-13. Amends [0010](0010-firmware-target-evaluation.md), which stays the evidence gate for *which* target ships first.

## Context

ARCHITECTURE.md §18.1 frames the firmware target as a fork: PlatformIO C++ with a generated `app.cpp`, or ESPHome YAML. It calls this "the highest-leverage decision on this list," and M4 is written for the first answer.

Track E ([0010](0010-firmware-target-evaluation.md), [FIRMWARE-TARGET.md](../FIRMWARE-TARGET.md)) built both fridge monitors and measured them. Two of its findings change the shape of the question:

- **ESPHome still compiles firmware.** YAML validation is an earlier gate, not a replacement for the compile gate, the pinned builder, bounded repair or artifact publication. The saving is in *driver and runtime ownership*, not in the build pipeline.
- **Neither target is a superset.** ESPHome has native components for every MVP sensor, an encrypted Home Assistant API, and signed OTA verification ([ESPHome 2026.4](https://esphome.io/blog/2026/04/15/esphome-2026-4/), RSA-3072 or ECDSA-256, ESP-IDF). It does **not** ship hardware Secure Boot or flash encryption ([esphome/esphome#15357](https://github.com/esphome/esphome/pull/15357) is explicit that it is signature verification only), and it has no store-and-forward buffer for offline readings. Both are things §10 and CLOUD-PLATFORM.md §10 promise.
- **Licensing differs by target, not by feature.** ESPHome's C++ runtime — what is linked into a shipped binary — is **GPLv3**; its Python tooling is MIT ([LICENSE](https://github.com/esphome/esphome/blob/dev/LICENSE)). Flashing kits at the factory and handing a builder a YAML file to compile are different distribution situations. **This needs counsel before either is promised, and this ADR does not settle it.**

So the fork as written asks us to pick a loser before M4, when the two targets serve different customers: the kit buyer on the metered cloud tier, and the Home Assistant builder who wants local-first hardware.

The costly half of "support both" is not having two targets. It is having **two of everything a target touches** — two driver sets, two self-test implementations, two OTA systems, two ingest clients, two compatibility matrices, and a registry that silently assumes one of them.

## Decision

**A firmware target is an adapter behind three contracts that do not mention it. Adding or dropping a target changes an adapter, never a contract.**

### The three contracts

1. **The plan is target-neutral.** `BuildPlan` pins parts, pin assignments, channels and alert rules. It names no framework, language or component. Anything a target needs that the plan cannot express is a gap in the plan, not a per-target field.
2. **The device↔cloud contract is the wire, not the firmware.** Envelope v1, `(dev, seq)` idempotency, NVS-backed monotonic `seq`, offline buffering with replay, the `next_s` backpressure lever, command acknowledgement and expiry, and the `st.health` self-test channel (CLOUD-PLATFORM.md §3.3, §3.4, §4.2; ARCHITECTURE.md §10). Ingest cannot tell which firmware sent a packet, and must never need to.
3. **The target interface is `emit → build → verify`.** Each target implements: emit a source bundle from a plan; build it in a pinned, isolated toolchain; verify the result. The compile gate, bounded repair, template fallback, artifact provenance and the code/body join from [ASK-TO-ENCLOSURE.md](../ASK-TO-ENCLOSURE.md) §5 belong to the interface and are identical for every target.

### The registry carries per-target mappings, not a target

`PartSoftware` (`packages/schema/src/part.ts`) today has one target's vocabulary inline: `driver_pkg`, `driver_version`, `sdk_module`, `min_runtime`. **`capabilities` is the target-neutral part and stays where it is.** The rest moves under a `targets` map keyed by target id, each entry carrying that target's own mapping and its own `min_runtime`. A part declares support for a target by having an entry; absence is "not supported here," not "broken."

This is a schema change with a migration, so it lands in **M1 or M3, before M4 writes a generator against the current shape**. It is cheap now and a migration later.

### Conformance, not good intentions

One **target conformance suite** proves contract 2 against a real device: envelope shape, `seq` monotonic across reboot and power loss, replay after an outage, retry with the same idempotency key, command ack and expiry, and self-test health codes. **A target that has not passed it cannot be offered for a build**, whatever its source language. Track E's gates in [FIRMWARE-TARGET.md](../FIRMWARE-TARGET.md) stay as written and feed this suite.

### One target is the default, and it is a product decision

Supporting a target is not the same as shipping it. Exactly one target is the **default for sold kits and the cloud tier** — the one carrying Secure Boot, flash encryption, self-test and signed staged OTA, because the patch pledge (§10) and ~90% of revenue rest on it. Any other target is offered with its guarantees stated plainly on the build page, including which ones it does not provide. [0010](0010-firmware-target-evaluation.md) picks the default on evidence; this ADR only guarantees that picking it does not delete the alternative.

## Consequences

- **M4 builds one target, against the interface.** No second generator is written until a target passes conformance and there is a customer for it. The cost of this ADR before then is the interface seam and the registry shape — days, not a milestone.
- **ARCHITECTURE.md §18.1's "Firmware target" row is reframed, not resolved.** The fork becomes "which target is the default," and the row should say so once this is accepted.
- **§7.3 and §7.5 become target-specific sections under a shared gate.** `hsx-rt`, `hsx-sdk` and the four drivers are the native target's adapter, not the system's definition. The `compat_matrix` gains a target axis.
- **The self-test block (§10) is specified once as behaviour and health codes**, and implemented per target. Codegen's "third generated block" gap applies to every target equally.
- **Secure Boot and flash encryption are the native target's**, via ESP-IDF directly. An ESPHome target would carry signed OTA verification without hardware secure boot, and that difference is disclosed, never smoothed over.
- **An ESPHome target needs an `albus_cloud` external component** for buffering, ingest and OTA checks. Given the GPLv3 runtime it links against, it is open-sourced. It is also the natural conformance-suite reference implementation.
- **Registry work grows per part per target.** A part supported on two targets needs two mappings and two sets of bench evidence. This is the real recurring cost, and it is why the default target ships first and alone.
- **The licence question stays open and blocking** for any factory-flashed non-default target. Counsel answers it; engineering does not.
