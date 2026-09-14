"""Capture bounded UART logs; optionally reset the board before capture."""
import argparse
import time
import serial

parser = argparse.ArgumentParser()
parser.add_argument('--seconds', type=int, default=30)
parser.add_argument('--reset', action='store_true')
args = parser.parse_args()
port = serial.Serial()
port.port = '/dev/cu.usbmodem5B7A1164331'
port.baudrate = 115200
port.timeout = 0.5
port.dtr = False
port.rts = False
port.open()
try:
    if args.reset:
        port.rts = True
        time.sleep(0.1)
        port.rts = False
    deadline = time.monotonic() + args.seconds
    while time.monotonic() < deadline:
        data = port.read(port.in_waiting or 1)
        if data:
            print(data.decode('utf-8', errors='replace'), end='', flush=True)
finally:
    port.close()
