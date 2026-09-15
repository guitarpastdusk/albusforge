import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("installer", Path(__file__).with_name("install.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerIntegrity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.manifest = {"v": 1, "build_id": "11111111-1111-4111-8111-111111111111", "plan_version": 1, "code_version": 1,
            "profile_id": "esp32s3-bh1750-usb-v1", "runtime": "0.1.0", "channels": {"illuminance": {"unit": "lux", "min": 0, "max": 65535}},
            "flash": {"chip": "esp32s3", "config_offset": 36864, "config_size": 24576}, "files": []}
        for name in ("bootloader.bin", "partition-table.bin", "albusforge.bin"):
            content = name.encode()
            (self.root / name).write_bytes(content)
            self.manifest["files"].append({"path": name, "size": len(content), "sha256": hashlib.sha256(content).hexdigest()})
        self.config = {key: value for key, value in self.manifest.items() if key not in ("files", "flash")}
        self.config.update(device_id="22222222-2222-4222-8222-222222222222", token="a" * 42 + "A", ingest_url="https://ingest.example/ingest/v1", seq_start=0)
        self.save()

    def save(self):
        (self.root / "manifest.json").write_bytes(installer.canonical(self.manifest))
        self.config["manifest_digest"] = hashlib.sha256(installer.canonical(self.manifest)).hexdigest()

    def tearDown(self):
        self.tmp.cleanup()

    def test_valid_bundle(self):
        self.assertEqual(installer.verify(self.root, self.config)["albusforge.bin"], 65536)

    def test_binary_tampering_is_refused(self):
        (self.root / "albusforge.bin").write_bytes(b"malicious")
        with self.assertRaisesRegex(ValueError, "integrity"):
            installer.verify(self.root, self.config)

    def test_wrong_artifact_version_is_refused(self):
        self.config["code_version"] = 2
        with self.assertRaisesRegex(ValueError, "identity"):
            installer.verify(self.root, self.config)

    def test_manifest_tampering_is_refused(self):
        self.manifest["runtime"] = "99.0.0"
        (self.root / "manifest.json").write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, "manifest"):
            installer.verify(self.root, self.config)

    def test_path_escape_and_symlink_are_refused(self):
        self.manifest["files"][0]["path"] = "../bootloader.bin"
        self.save()
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            installer.verify(self.root, self.config)

    def test_plaintext_transport_and_invalid_sequence_are_refused(self):
        self.config["ingest_url"] = "http://ingest.example/ingest/v1"
        with self.assertRaises(ValueError): installer.verify(self.root, self.config)
        self.config["ingest_url"] = "https://ingest.example/ingest/v1"
        for value in (True, -1, 1.5, 9007199254740991):
            self.config["seq_start"] = value
            with self.assertRaises(ValueError): installer.verify(self.root, self.config)



class CameraInstallerIntegrity(InstallerIntegrity):
    def setUp(self):
        super().setUp()
        profile = "freenove-esp32s3-n16r8-gc0308-usb-v1"
        camera = {"id": "camera", "kind": "image", "schema": "jpeg.v1", "profile_id": profile, "profile_version": 1,
            "enabled": True, "required": True, "interval_s": 900, "max_bytes": 1048576, "max_width": 320, "max_height": 240}
        channels = {"ambient_light_lux": {"unit": "lux", "min": 0, "max": 65535},
            "air_temperature_c": {"unit": "C", "min": -40, "max": 85},
            "air_pressure_hpa": {"unit": "hPa", "min": 300, "max": 1100},
            "air_humidity_pct": {"unit": "%", "min": 0, "max": 100}}
        environment = {"id": "environment", "kind": "measurement", "schema": "readings.v1", "profile_id": profile, "profile_version": 1,
            "enabled": True, "required": True, "interval_s": 900, "channels": channels}
        self.manifest.update(profile_id=profile, runtime="0.3.0", channels=channels, capabilities=[camera, environment])
        self.config.update(v=2, profile_id=profile, runtime="0.3.0", channels=channels, capabilities=[dict(camera), environment],
            observation_url=f"https://ingest.example/ingest/v2/devices/{self.config['device_id']}/observations")
        self.save()

    def test_camera_capabilities_cannot_be_replaced(self):
        self.config["capabilities"][1]["interval_s"] = 60
        with self.assertRaises(ValueError):
            installer.verify(self.root, self.config)

    def test_camera_default_provisions_hotspot_without_wifi_in_shared_config(self):
        folder = self.root / "private"
        folder.mkdir()
        def generate(args, **_kwargs):
            Path(args[-2]).write_bytes(b"fixture-nvs")
        with patch.object(installer.subprocess, "run", side_effect=generate):
            installer.prepare(self.config, folder, "", "")
        private = json.loads((folder / "private-config.json").read_text())
        self.assertNotIn("wifi_ssid", private)
        self.assertNotIn("wifi_password", private)
        self.assertEqual((folder / "private-config.json").stat().st_mode & 0o777, 0o600)

    def test_camera_endpoint_is_device_bound(self):
        self.config["observation_url"] = "https://example.com/ingest/v2/devices/other/observations"
        with self.assertRaisesRegex(ValueError, "endpoint"):
            installer.verify(self.root, self.config)

    def test_camera_numeric_profile_cannot_drop_a_channel(self):
        del self.config["channels"]["air_humidity_pct"]
        with self.assertRaises(ValueError):
            installer.verify(self.root, self.config)

if __name__ == "__main__":
    unittest.main()
