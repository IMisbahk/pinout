#include <Arduino.h>
#include <ArduinoJson.h>

constexpr uint32_t baudRate = 115200;
constexpr size_t lineMax = 512;
constexpr int protocolVersion = 1;
constexpr const char* firmwareName = "esp32-bridge";
constexpr const char* firmwareVersion = "0.1.0";

char lineBuffer[lineMax];
size_t lineLength = 0;

bool isFlashPin(int pin) { return pin >= 6 && pin <= 11; }
bool isInputOnlyPin(int pin) { return pin >= 34 && pin <= 39; }
bool isUart0Pin(int pin) { return pin == 1 || pin == 3; }
bool isStrapPin(int pin) { return pin == 12; }

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

void fillIdentity(JsonObject payload) {
  payload["firmware"] = firmwareName;
  payload["version"] = firmwareVersion;
  payload["protocol"] = protocolVersion;
  JsonArray capabilities = payload["capabilities"].to<JsonArray>();
  capabilities.add("sys.hello");
  capabilities.add("gpio.write");
  capabilities.add("gpio.read");
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
  if (strcmp(action, "gpio.write") == 0) {
    handleGpioWrite(id, payload);
    return;
  }
  if (strcmp(action, "gpio.read") == 0) {
    handleGpioRead(id, payload);
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
  delay(100);
  while (Serial.available() > 0) {
    Serial.read();
  }
  sendReady();
}

void loop() {
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
