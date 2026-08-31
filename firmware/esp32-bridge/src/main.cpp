#include <Arduino.h>
#include <ArduinoJson.h>

constexpr uint32_t baudRate = 115200;
constexpr size_t lineMax = 512;
constexpr int protocolVersion = 1;
constexpr const char* firmwareName = "esp32-bridge";
constexpr const char* firmwareVersion = "0.1.0";

char lineBuffer[lineMax];
size_t lineLength = 0;
unsigned long bootMillis = 0;

struct WatchState {
  int pin = -1;
  bool lastValue = false;
  bool active = false;
};

WatchState watches[8];
size_t watchCount = 0;

bool isFlashPin(int pin) { return pin >= 6 && pin <= 11; }
bool isInputOnlyPin(int pin) { return pin >= 34 && pin <= 39; }
bool isUart0Pin(int pin) { return pin == 1 || pin == 3; }
bool isStrapPin(int pin) { return pin == 12; }
bool isAdcPin(int pin) { return pin >= 32 && pin <= 39; }

bool isReadablePin(int pin) {
  return pin >= 0 && pin <= 39 && !isFlashPin(pin) && !isUart0Pin(pin) && !isStrapPin(pin);
}

bool isWritablePin(int pin) {
  return isReadablePin(pin) && !isInputOnlyPin(pin);
}

void sendLine(const JsonDocument& document) {
  serializeJson(document, Serial);
  Serial.write('\n');
}

void sendError(const char* id, const char* code, const char* message) {
  JsonDocument document;
  document["v"] = protocolVersion;
  document["id"] = id;
  document["ok"] = false;
  JsonObject error = document["error"].to<JsonObject>();
  error["code"] = code;
  error["message"] = message;
  sendLine(document);
}

void sendSuccess(const char* id, const JsonDocument& result) {
  JsonDocument document;
  document["v"] = protocolVersion;
  document["id"] = id;
  document["ok"] = true;
  document["result"] = result;
  sendLine(document);
}

void sendEvent(const char* event, const JsonDocument& payload) {
  JsonDocument document;
  document["v"] = protocolVersion;
  document["event"] = event;
  document["payload"] = payload;
  sendLine(document);
}

void emitGpioChanged(int pin, bool value) {
  JsonDocument payload;
  payload["pin"] = pin;
  payload["value"] = value;
  sendEvent("gpio.changed", payload);
}

void fillIdentity(JsonObject payload) {
  payload["firmware"] = firmwareName;
  payload["version"] = firmwareVersion;
  payload["protocol"] = protocolVersion;
  JsonArray capabilities = payload["capabilities"].to<JsonArray>();
  capabilities.add("sys.hello");
  capabilities.add("sys.ping");
  capabilities.add("sys.info");
  capabilities.add("gpio.mode");
  capabilities.add("gpio.write");
  capabilities.add("gpio.read");
  capabilities.add("gpio.toggle");
  capabilities.add("gpio.pulse");
  capabilities.add("gpio.pwm");
  capabilities.add("gpio.analogRead");
  capabilities.add("gpio.watch");
  capabilities.add("gpio.unwatch");
}

void sendReady() {
  JsonDocument document;
  document["v"] = protocolVersion;
  document["event"] = "ready";
  fillIdentity(document["payload"].to<JsonObject>());
  sendLine(document);
}

void handleHello(const char* id) {
  JsonDocument result;
  fillIdentity(result.to<JsonObject>());
  sendSuccess(id, result);
}

void handlePing(const char* id) {
  JsonDocument result;
  result["pong"] = true;
  sendSuccess(id, result);
}

void handleInfo(const char* id) {
  JsonDocument result;
  result["uptimeMs"] = millis() - bootMillis;
  result["freeHeap"] = ESP.getFreeHeap();
  sendSuccess(id, result);
}

void applyPinMode(int pin, const char* mode) {
  if (strcmp(mode, "output") == 0) {
    pinMode(pin, OUTPUT);
  } else if (strcmp(mode, "pullup") == 0) {
    pinMode(pin, INPUT_PULLUP);
  } else if (strcmp(mode, "pulldown") == 0) {
    pinMode(pin, INPUT_PULLDOWN);
  } else {
    pinMode(pin, INPUT);
  }
}

void handleGpioMode(const char* id, const JsonVariantConst& payload) {
  if (!payload.is<JsonObjectConst>() || !payload["pin"].is<int>() || !payload["mode"].is<const char*>()) {
    sendError(id, "INVALID_PAYLOAD", "gpio.mode requires integer pin and mode string.");
    return;
  }
  const int pin = payload["pin"].as<int>();
  const char* mode = payload["mode"];
  if (!isReadablePin(pin) || (strcmp(mode, "output") == 0 && !isWritablePin(pin))) {
    sendError(id, "INVALID_PIN", "Pin is not a valid ESP32 GPIO for this mode.");
    return;
  }
  applyPinMode(pin, mode);
  JsonDocument result;
  result["pin"] = pin;
  result["mode"] = mode;
  sendSuccess(id, result);
}

void handleGpioWrite(const char* id, const JsonVariantConst& payload) {
  if (!payload.is<JsonObjectConst>() || !payload["pin"].is<int>() || !payload["value"].is<bool>()) {
    sendError(id, "INVALID_PAYLOAD", "gpio.write requires integer pin and boolean value.");
    return;
  }
  const int pin = payload["pin"].as<int>();
  const bool value = payload["value"].as<bool>();
  if (!isWritablePin(pin)) {
    sendError(id, "INVALID_PIN", "Pin is not a valid ESP32 output GPIO.");
    return;
  }
  pinMode(pin, OUTPUT);
  digitalWrite(pin, value ? HIGH : LOW);
  JsonDocument result;
  result["pin"] = pin;
  result["value"] = value;
  sendSuccess(id, result);
}

void handleGpioRead(const char* id, const JsonVariantConst& payload) {
  if (!payload.is<JsonObjectConst>() || !payload["pin"].is<int>()) {
    sendError(id, "INVALID_PAYLOAD", "gpio.read requires integer pin.");
    return;
  }
  const int pin = payload["pin"].as<int>();
  if (!isReadablePin(pin)) {
    sendError(id, "INVALID_PIN", "Pin is not a valid ESP32 GPIO.");
    return;
  }
  JsonDocument result;
  result["pin"] = pin;
  result["value"] = digitalRead(pin) == HIGH;
  sendSuccess(id, result);
}

void handleGpioToggle(const char* id, const JsonVariantConst& payload) {
  if (!payload.is<JsonObjectConst>() || !payload["pin"].is<int>()) {
    sendError(id, "INVALID_PAYLOAD", "gpio.toggle requires integer pin.");
    return;
  }
  const int pin = payload["pin"].as<int>();
  if (!isWritablePin(pin)) {
    sendError(id, "INVALID_PIN", "Pin is not a valid ESP32 output GPIO.");
    return;
  }
  pinMode(pin, OUTPUT);
  const bool value = digitalRead(pin) != HIGH;
  digitalWrite(pin, value ? HIGH : LOW);
  JsonDocument result;
  result["pin"] = pin;
  result["value"] = value;
  sendSuccess(id, result);
}

void handleGpioPulse(const char* id, const JsonVariantConst& payload) {
  if (!payload.is<JsonObjectConst>() || !payload["pin"].is<int>() || !payload["value"].is<bool>() ||
      !payload["durationMs"].is<int>()) {
    sendError(id, "INVALID_PAYLOAD", "gpio.pulse requires pin, value, and durationMs.");
    return;
  }
  const int pin = payload["pin"].as<int>();
  const bool value = payload["value"].as<bool>();
  const int durationMs = payload["durationMs"].as<int>();
  if (durationMs <= 0 || !isWritablePin(pin)) {
    sendError(id, "INVALID_PIN", "Pin is not a valid ESP32 output GPIO.");
    return;
  }
  pinMode(pin, OUTPUT);
  digitalWrite(pin, value ? HIGH : LOW);
  delay(durationMs);
  digitalWrite(pin, LOW);
  JsonDocument result;
  result["pin"] = pin;
  result["value"] = value;
  result["durationMs"] = durationMs;
  sendSuccess(id, result);
}

void handleGpioPwm(const char* id, const JsonVariantConst& payload) {
  if (!payload.is<JsonObjectConst>() || !payload["pin"].is<int>() || !payload["duty"].is<float>() ||
      !payload["channel"].is<int>() || !payload["frequency"].is<int>()) {
    sendError(id, "INVALID_PAYLOAD", "gpio.pwm requires pin, channel, duty, and frequency.");
    return;
  }
  const int pin = payload["pin"].as<int>();
  const int channel = payload["channel"].as<int>();
  const float duty = payload["duty"].as<float>();
  const int frequency = payload["frequency"].as<int>();
  if (!isWritablePin(pin) || channel < 0 || channel > 15 || duty < 0 || duty > 1 || frequency <= 0) {
    sendError(id, "INVALID_PIN", "Invalid PWM pin or parameters.");
    return;
  }
  ledcSetup(channel, frequency, 8);
  ledcAttachPin(pin, channel);
  ledcWrite(channel, static_cast<uint32_t>(duty * 255));
  JsonDocument result;
  result["pin"] = pin;
  result["channel"] = channel;
  result["duty"] = duty;
  result["frequency"] = frequency;
  sendSuccess(id, result);
}

void handleGpioAnalogRead(const char* id, const JsonVariantConst& payload) {
  if (!payload.is<JsonObjectConst>() || !payload["pin"].is<int>()) {
    sendError(id, "INVALID_PAYLOAD", "gpio.analogRead requires integer pin.");
    return;
  }
  const int pin = payload["pin"].as<int>();
  if (!isAdcPin(pin) || !isReadablePin(pin)) {
    sendError(id, "INVALID_PIN", "Pin is not a valid ESP32 ADC GPIO.");
    return;
  }
  JsonDocument result;
  result["pin"] = pin;
  result["value"] = analogRead(pin);
  sendSuccess(id, result);
}

void handleGpioWatch(const char* id, const JsonVariantConst& payload) {
  if (!payload.is<JsonObjectConst>() || !payload["pin"].is<int>()) {
    sendError(id, "INVALID_PAYLOAD", "gpio.watch requires integer pin.");
    return;
  }
  const int pin = payload["pin"].as<int>();
  if (!isReadablePin(pin)) {
    sendError(id, "INVALID_PIN", "Pin is not a valid ESP32 GPIO.");
    return;
  }
  if (watchCount < 8) {
    watches[watchCount].pin = pin;
    watches[watchCount].lastValue = digitalRead(pin) == HIGH;
    watches[watchCount].active = true;
    watchCount++;
  }
  JsonDocument result;
  result["pin"] = pin;
  result["watching"] = true;
  sendSuccess(id, result);
}

void handleGpioUnwatch(const char* id, const JsonVariantConst& payload) {
  if (!payload.is<JsonObjectConst>() || !payload["pin"].is<int>()) {
    sendError(id, "INVALID_PAYLOAD", "gpio.unwatch requires integer pin.");
    return;
  }
  const int pin = payload["pin"].as<int>();
  for (size_t i = 0; i < watchCount; i++) {
    if (watches[i].pin == pin) {
      watches[i].active = false;
    }
  }
  JsonDocument result;
  result["pin"] = pin;
  result["watching"] = false;
  sendSuccess(id, result);
}

void pollWatches() {
  for (size_t i = 0; i < watchCount; i++) {
    if (!watches[i].active || watches[i].pin < 0) {
      continue;
    }
    const bool value = digitalRead(watches[i].pin) == HIGH;
    if (value != watches[i].lastValue) {
      watches[i].lastValue = value;
      emitGpioChanged(watches[i].pin, value);
    }
  }
}

void handleRequest(JsonDocument& document) {
  if (!document["id"].is<const char*>() || !document["action"].is<const char*>()) {
    sendError("invalid", "INVALID_MESSAGE", "Request must include string id and action.");
    return;
  }

  const char* id = document["id"];
  const char* action = document["action"];
  const JsonVariantConst payload = document["payload"];

  if (strcmp(action, "sys.hello") == 0) {
    handleHello(id);
    return;
  }
  if (strcmp(action, "sys.ping") == 0) {
    handlePing(id);
    return;
  }
  if (strcmp(action, "sys.info") == 0) {
    handleInfo(id);
    return;
  }
  if (strcmp(action, "gpio.mode") == 0) {
    handleGpioMode(id, payload);
    return;
  }
  if (strcmp(action, "gpio.write") == 0) {
    handleGpioWrite(id, payload);
    return;
  }
  if (strcmp(action, "gpio.read") == 0) {
    handleGpioRead(id, payload);
    return;
  }
  if (strcmp(action, "gpio.toggle") == 0) {
    handleGpioToggle(id, payload);
    return;
  }
  if (strcmp(action, "gpio.pulse") == 0) {
    handleGpioPulse(id, payload);
    return;
  }
  if (strcmp(action, "gpio.pwm") == 0) {
    handleGpioPwm(id, payload);
    return;
  }
  if (strcmp(action, "gpio.analogRead") == 0) {
    handleGpioAnalogRead(id, payload);
    return;
  }
  if (strcmp(action, "gpio.watch") == 0) {
    handleGpioWatch(id, payload);
    return;
  }
  if (strcmp(action, "gpio.unwatch") == 0) {
    handleGpioUnwatch(id, payload);
    return;
  }

  sendError(id, "UNKNOWN_ACTION", "Unknown action.");
}

void handleLine(char* line) {
  while (*line == ' ' || *line == '\r') {
    line++;
  }
  if (line[0] != '{') {
    return;
  }

  JsonDocument document;
  const DeserializationError error = deserializeJson(document, line);
  if (error) {
    sendError("invalid", "INVALID_JSON", "Request is not valid JSON.");
    return;
  }

  if (document["v"] != protocolVersion) {
    sendError("invalid", "INVALID_MESSAGE", "Unsupported protocol version.");
    return;
  }

  handleRequest(document);
}

void setup() {
  Serial.setRxBufferSize(1024);
  Serial.begin(baudRate);
  bootMillis = millis();
  delay(100);
  while (Serial.available() > 0) {
    Serial.read();
  }
  sendReady();
}

void loop() {
  pollWatches();
  while (Serial.available() > 0) {
    const char next = static_cast<char>(Serial.read());
    if (next == '\n') {
      lineBuffer[lineLength] = '\0';
      lineLength = 0;
      handleLine(lineBuffer);
      continue;
    }
    if (lineLength >= lineMax - 1) {
      lineLength = 0;
      sendError("invalid", "INVALID_MESSAGE", "Request line is too long.");
      continue;
    }
    if (next != '\r') {
      lineBuffer[lineLength++] = next;
    }
  }
}
