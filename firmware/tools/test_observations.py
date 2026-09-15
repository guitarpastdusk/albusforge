"""Run portable C scheduler, retry and actual-file spool recovery tests."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class ObservationPolicies(unittest.TestCase):
    def test_durable_spool_ownership(self):
        firmware = Path(__file__).resolve().parents[1]
        main = firmware / "esp32s3-camera" / "main"
        with tempfile.TemporaryDirectory(prefix="albus-camera-owner-") as folder:
            executable = str(Path(folder) / "owner")
            subprocess.run([os.environ.get("CC", "cc"), "-std=c11", "-D_POSIX_C_SOURCE=200809L", "-D_DARWIN_C_SOURCE", "-DOBS_OWNER_TESTING",
                "-Wall", "-Wextra", "-Werror", f"-I{main / 'include'}", str(main / "observation_policy.c"),
                str(main / "observation_owner.c"), str(firmware / "tests" / "observation_owner.c"), "-o", executable], check=True)
            subprocess.run([executable], check=True, timeout=30)

    def test_native_observation_policies(self):
        firmware = Path(__file__).resolve().parents[1]
        main = firmware / "esp32s3-camera" / "main"
        with tempfile.TemporaryDirectory(prefix="albus-camera-policy-") as folder:
            executable = str(Path(folder) / "observations")
            subprocess.run([os.environ.get("CC", "cc"), "-std=c11", "-D_POSIX_C_SOURCE=200809L", "-D_DARWIN_C_SOURCE",
                "-Wall", "-Wextra", "-Werror", f"-I{main / 'include'}", str(main / "observation_policy.c"),
                str(main / "observation_spool.c"), str(main / "setup_form.c"), str(firmware / "tests" / "observations.c"), "-o", executable], check=True)
            subprocess.run([executable], check=True, timeout=30)

    def test_plant_telemetry_packet(self):
        firmware = Path(__file__).resolve().parents[1]
        main = firmware / "esp32s3-camera" / "main"
        with tempfile.TemporaryDirectory(prefix="albus-plant-telemetry-") as folder:
            executable = str(Path(folder) / "telemetry")
            subprocess.run([os.environ.get("CC", "cc"), "-std=c11", "-Wall", "-Wextra", "-Werror",
                f"-I{main / 'include'}", str(main / "telemetry_packet.c"),
                str(firmware / "tests" / "telemetry_packet.c"), "-lm", "-o", executable], check=True)
            subprocess.run([executable], check=True, timeout=30)


if __name__ == "__main__":
    unittest.main()
