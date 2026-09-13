# P-004 MPU-6050: sources

Module: Adafruit MPU-6050, STEMMA QT (#3886). Checked 2026-09-13.

- Size 26.0 × 17.8 × 4.6 mm, four 2.5 mm mounting holes, price $12.95: https://www.adafruit.com/product/3886
- Module supply 3–5 V (onboard regulator), I²C address 0x68 (0x69 with AD0 high or the jumper): https://learn.adafruit.com/mpu6050-6-dof-accelerometer-and-gyro/pinouts
- Idle 5 µA typ, gyro + accel 3.8 mA typ, chip range −40…85 °C: MPU-6000/6050 product specification rev 3.4, https://cdn.sparkfun.com/datasheets/Components/General%20IC/PS-MPU-6000A.pdf

Not verified: hole positions. The fab print is an image only, and the PCB source is at https://github.com/adafruit/Adafruit-MPU6050-PCB. The mount is `unspecified` until someone measures them.
