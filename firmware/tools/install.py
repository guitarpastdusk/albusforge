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
from urllib.parse import urlsplit


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
    if config.get("v") == 2:
        if config.get("capabilities") != manifest.get("capabilities"):
            raise ValueError("Configuration capability identity does not match firmware")
        if config.get("profile_id") != "freenove-esp32s3-n16r8-gc0308-usb-v1" or config.get("runtime") != "0.3.0":
            raise ValueError("Unsupported camera profile")
        expected_camera = {"id": "camera", "kind": "image", "schema": "jpeg.v1", "profile_id": config["profile_id"], "profile_version": 1,
            "enabled": True, "required": True, "interval_s": 900, "max_bytes": 1048576, "max_width": 320, "max_height": 240}
        expected_channels = {"ambient_light_lux": {"unit": "lux", "min": 0, "max": 65535},
            "air_temperature_c": {"unit": "C", "min": -40, "max": 85},
            "air_pressure_hpa": {"unit": "hPa", "min": 300, "max": 1100},
            "air_humidity_pct": {"unit": "%", "min": 0, "max": 100}}
        expected_measurement = {"id": "environment", "kind": "measurement", "schema": "readings.v1", "profile_id": config["profile_id"], "profile_version": 1,
            "enabled": True, "required": True, "interval_s": 900, "channels": expected_channels}
        if config.get("capabilities") != [expected_camera, expected_measurement] or config.get("channels") != expected_channels:
            raise ValueError("Unsupported camera capability")
        ingest = urlsplit(config.get("ingest_url", ""))
        if ingest.scheme != "https" or not ingest.hostname or ingest.username or ingest.password or ingest.query or ingest.fragment or ingest.path != "/ingest/v1":
            raise ValueError("Invalid ingestion endpoint")
        endpoint = urlsplit(config.get("observation_url", ""))
        if endpoint.scheme != ingest.scheme or endpoint.netloc != ingest.netloc or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment or endpoint.path != f"/ingest/v2/devices/{config['device_id']}/observations":
            raise ValueError("Invalid observation endpoint")
    elif config.get("v") != 1 or config.get("profile_id") != "esp32s3-bh1750-usb-v1":
        raise ValueError("Unsupported firmware configuration version")
    if not config.get("ingest_url", "").startswith("https://"):
        raise ValueError("Firmware requires an HTTPS ingestion endpoint")
    if type(config.get("seq_start")) is not int or not 0 <= config["seq_start"] < 9007199254740991:
        raise ValueError("Invalid sequence reservation")
    return expected


def prepare(config, folder, ssid, password):
    hotspot = config.get("v") == 2 and not ssid and not password
    if not hotspot and (not 1 <= len(ssid.encode()) <= 32 or not 8 <= len(password.encode()) <= 63):
        raise ValueError("Wi-Fi requires a 1–32 byte SSID and 8–63 byte WPA2 password")
    private = dict(config)
    if hotspot:
        private.pop("wifi_ssid", None)
        private.pop("wifi_password", None)
    else:
        private.update(wifi_ssid=ssid, wifi_password=password)
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
    if config.get("v") == 2:
        ssid, password = "", ""
        print("After flashing, read the temporary Plant-A Setup password over USB serial, join that hotspot, and open http://192.168.4.1. Wi-Fi credentials stay on the board.")
    else:
        ssid = input("Wi-Fi SSID (kept locally): ")
        password = getpass.getpass("Wi-Fi password (kept locally): ")
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="albus-config-") as directory:
        image = prepare(config, Path(directory), ssid, password)
        command = [sys.executable, "-m", "esptool", "--chip", "esp32s3", "--port", args.port, "--baud", "115200", "write_flash", "--flash_size", "16MB" if config.get("v") == 2 else "8MB"]
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
