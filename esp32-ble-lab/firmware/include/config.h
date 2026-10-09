#pragma once
#include <stdint.h>

constexpr int SDA_PIN = 21;
constexpr int SCL_PIN = 22;
constexpr uint8_t PCA_ADDRESS = 0x40;
constexpr float SERVO_FREQUENCY = 50.0f;
// Start conservatively. Adjust only after checking your servo and mechanism.
constexpr uint16_t MIN_ANGLE = 6000;  // hundredths of a degree
constexpr uint16_t MAX_ANGLE = 12000;
constexpr uint16_t MIN_PULSE_US = 1000; // nominal 0 degrees
constexpr uint16_t MAX_PULSE_US = 2000; // nominal 180 degrees
constexpr uint32_t HEARTBEAT_TIMEOUT_MS = 5000;
constexpr char DEVICE_NAME[] = "ESP32-BLE-Lab";
constexpr char SERVICE_UUID[] = "f3641400-00b0-4240-ba50-05ca45bf8abc";
constexpr char COMMAND_UUID[] = "f3641401-00b0-4240-ba50-05ca45bf8abc";
constexpr char TELEMETRY_UUID[] = "f3641402-00b0-4240-ba50-05ca45bf8abc";
constexpr char STATUS_UUID[] = "f3641403-00b0-4240-ba50-05ca45bf8abc";

