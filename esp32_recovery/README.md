# ESP32 / L298N / GY-521 restoration test

This PlatformIO project matches `ESP32-motor-IMU(3).fzz` as inspected on 2026-09-27.

## Before connecting power

- ESP32 VIN is disconnected. Power ESP32 only through its Micro USB socket.
- Motor adapter is set to 5 V (measured 5.1 V) and supplies L298N's `12V`-labeled terminal.
- L298N `5V-EN` jumper is REMOVED. Its `12V` and `5V` terminals are linked to provide the same regulated 5 V to motor and logic sides. The measured `5V`-to-GND reading was 5.05 V.
- Motor adapter GND and ESP32 GND remain common. Do not connect the two sources' positive leads to each other.
- Both encoder supplies and GY-521 VCC in the drawing connect to ESP32 3V3. Confirm encoder outputs never exceed 3.3 V at GPIO pins.
- Remove any ENA/ENB jumpers that tie the enables HIGH: GPIO26 and GPIO19 control those pins in this drawing.

## Wiring from the drawing

| Component | ESP32 GPIO |
| --- | --- |
| L298N ENA, IN1, IN2 | 26, 27, 14 |
| L298N ENB, IN3, IN4 | 19, 18, 4 |
| Motor 1 encoder A, B | 33, 25 |
| Motor 2 encoder A, B | 32, 23 |
| GY-521 SDA, SCL | 21, 22 |

The actual forward direction and A/B encoder phase are not yet verified. The count may decrease when turned in the expected forward direction; that is not a failure.

## Run

Open this folder in VS Code with PlatformIO. Upload, then open the serial monitor at 115200 baud. Press EN/RESET while the monitor is open to see the I2C scan at startup. The scanner finds the GY-521 at 0x68 or 0x69 automatically. If it shows no GY-521, measure its VCC-to-GND voltage and check SDA→GPIO21 and SCL→GPIO22; encoder readings continue without repeated I2C errors. With motor power off, tilt the board to see sensor values change and rotate each wheel by hand to check the counters. Then raise both wheels, connect 5 V motor power, and type `1` or `2` to run only that motor for up to 2 seconds. `s` stops immediately; reset also starts with outputs disabled. If a motor does not turn, measure voltage at the L298N 5V terminal during the run and verify ENA/ENB jumpers and adapter current capacity.

No motor moves automatically at power-up. Keep the wheels clear of the table and hands while testing; the software limit is 2 seconds per command. This sketch does not implement speed or position control.
