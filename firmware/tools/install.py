#!/usr/bin/env python3
"""Verify a compiled bundle, privately prepare NVS config and flash an ESP32-S3.
No credentials are sent to the compiler or written inside shared firmware files.
"""
import argparse
import csv
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def verify(bundle, config):
    manifest_bytes = (bundle / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    if hashlib.sha256(manifest_bytes).hexdigest() != config.get("manifest_digest"):
        raise ValueError("Configuration does not match this compiled manifest")
    for key in ("build_id", "plan_version", "code_version", "profile_id", "runtime", "channels"):
        if config.get(key) != manifest.get(key):
            raise ValueError("Configuration identity does not match firmware")
    if manifest.get("flash") != {"chip": "esp32s3", "config_offset": 36864, "config_size": 24576}:
        raise ValueError("Unsupported flash layout")
    expected = {"bootloader.bin": 0, "partition-table.bin": 32768, "albusforge.bin": 65536}
    if {entry["path"] for entry in manifest["files"]} != set(expected):
        raise ValueError("Unexpected firmware files")
    for entry in manifest["files"]:
        file = bundle / entry["path"]
        if file.is_symlink() or not file.is_file():
            raise ValueError("Invalid artifact file")
        data = file.read_bytes()
        if len(data) != entry["size"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise ValueError("Artifact integrity check failed")
    if not re.fullmatch(r"[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]", config.get("token", "")):
        raise ValueError("Invalid device credential")
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", config.get("device_id", "")):
        raise ValueError("Invalid device identity")
    if not config.get("ingest_url", "").startswith("https://"):
        raise ValueError("Firmware requires an HTTPS ingestion endpoint")
    if type(config.get("seq_start")) is not int or not 0 <= config["seq_start"] < 9007199254740991:
        raise ValueError("Invalid sequence reservation")
    return expected


def prepare(config, folder, ssid, password):
    if not 1 <= len(ssid.encode()) <= 32 or not 8 <= len(password.encode()) <= 63:
        raise ValueError("Wi-Fi requires a 1–32 byte SSID and 8–63 byte WPA2 password")
    private = dict(config, wifi_ssid=ssid, wifi_password=password)
    json_path = folder / "private-config.json"
    json_path.write_bytes(canonical(private))
    json_path.chmod(0o600)
    csv_path = folder / "nvs.csv"
    with csv_path.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerows([["key", "type", "encoding", "value"], ["albus", "namespace", "", ""], ["config", "file", "string", str(json_path)]])
    csv_path.chmod(0o600)
    image = folder / "albus-config.bin"
    subprocess.run([sys.executable, "-m", "esp_idf_nvs_partition_gen", "generate", str(csv_path), str(image), "0x6000"], check=True, stdout=subprocess.DEVNULL)
    image.chmod(0o600)
    return image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--port", required=True)
    args = parser.parse_args()
    config_bytes = args.config.read_bytes()
    config = json.loads(config_bytes)
    fingerprint = hashlib.sha256(config_bytes).hexdigest()
    marker = args.config.with_name(args.config.name + ".used")
    if marker.exists() and marker.read_text() == fingerprint:
        raise ValueError("This configuration was already used; request a fresh cloud reissue")
    expected = verify(args.bundle, config)
    ssid = input("Wi-Fi SSID (kept locally): ")
    password = getpass.getpass("Wi-Fi password (kept locally): ")
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="albus-config-") as directory:
        image = prepare(config, Path(directory), ssid, password)
        command = [sys.executable, "-m", "esptool", "--chip", "esp32s3", "--port", args.port, "write_flash", "--flash_size", "8MB"]
        for filename, offset in expected.items():
            command += [hex(offset), str(args.bundle / filename)]
        command += ["0x9000", str(image)]
        # Any flash attempt may have reached the device despite a lost response.
        # A fresh cloud reissue rotates the token and obtains the latest sequence.
        marker.write_text(fingerprint)
        marker.chmod(0o600)
        subprocess.run(command, check=True)
    print("Flash command completed. Wait for cloud reception to verify operation; compilation alone does not validate hardware.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError):
        # Parser/subprocess errors must never interpolate configuration or tokens.
        print("Installation failed. Check artifact/config identity, local tooling and USB connection. After a flash attempt, obtain a fresh cloud configuration before trying again.", file=sys.stderr)
        sys.exit(1)
