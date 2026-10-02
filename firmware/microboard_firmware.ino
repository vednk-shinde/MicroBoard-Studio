const int DIGITAL_PIN_COUNT = 14;
const int DIGITAL_PIN_START = 0;
const int DIGITAL_PIN_END = 13;

int pinModeState[DIGITAL_PIN_COUNT];
int pinLevelState[DIGITAL_PIN_COUNT];

int parsePinNumber(String token) {
  if (token.length() == 0) {
    return -1;
  }

  int pin = 0;
  for (unsigned int index = 0; index < token.length(); index++) {
    char digit = token.charAt(index);
    if (digit < '0' || digit > '9') {
      return -1;
    }
    pin = pin * 10 + (digit - '0');
  }

  return (pin >= DIGITAL_PIN_START && pin <= DIGITAL_PIN_END) ? pin : -1;
}

String modeLabelFor(int pin) {
  int currentMode = pinModeFor(pin);
  if (currentMode == OUTPUT) {
    return "OUTPUT";
  }
  if (currentMode == INPUT_PULLUP) {
    return "INPUT_PULLUP";
  }
  return "INPUT";
}

void setDigitalState(int pin, int level) {
  if (pin < DIGITAL_PIN_START || pin > DIGITAL_PIN_END) {
    return;
  }

  pinLevelState[pin] = level;
  digitalWrite(pin, level);
}

void configurePin(int pin, int mode) {
  if (pin < DIGITAL_PIN_START || pin > DIGITAL_PIN_END) {
    return;
  }

  pinModeState[pin] = mode;
  pinMode(pin, mode);

  if (mode == INPUT) {
    setDigitalState(pin, LOW);
  }
}

int pinModeFor(int pin) {
  if (pin < DIGITAL_PIN_START || pin > DIGITAL_PIN_END) {
    return INPUT;
  }

  return pinModeState[pin];
}

int readPinStateFor(int pin) {
  if (pin < DIGITAL_PIN_START || pin > DIGITAL_PIN_END) {
    return LOW;
  }

  if (pinModeFor(pin) == OUTPUT) {
    return pinLevelState[pin];
  }

  return digitalRead(pin);
}

void printStatusLine() {
  String status = "STATUS";

  for (int pin = DIGITAL_PIN_START; pin <= DIGITAL_PIN_END; pin++) {
    int level = readPinStateFor(pin);
    String levelLabel = (level == HIGH) ? "HIGH" : "LOW";

    status += " D";
    status += String(pin);
    status += " ";
    status += modeLabelFor(pin);
    status += " ";
    status += levelLabel;
  }

  Serial.println(status);
}

void setup() {
  Serial.begin(115200);
  delay(250);

  for (int pin = DIGITAL_PIN_START; pin <= DIGITAL_PIN_END; pin++) {
    pinModeState[pin] = INPUT;
    pinLevelState[pin] = LOW;
    pinMode(pin, INPUT);
  }

  Serial.println("READY");
}

void loop() {
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    if (command.length() == 0) {
      return;
    }

    String upperCommand = command;
    upperCommand.toUpperCase();

    String parts[4];
    int partCount = 0;

    for (int i = 0; i < command.length(); i++) {
      if (command.charAt(i) == ' ') {
        continue;
      }

      int start = i;
      while (i + 1 < command.length() && command.charAt(i + 1) != ' ') {
        i++;
      }

      parts[partCount++] = command.substring(start, i + 1);
      if (partCount >= 4) {
        break;
      }
    }

    if (partCount == 3 && parts[0].equalsIgnoreCase("SET")) {
      int pin = parsePinNumber(parts[1]);
      String level = parts[2];
      level.toUpperCase();

      if (pin < 0) {
        Serial.println("ERROR SET INVALID_PIN");
      } else if (pinModeFor(pin) != OUTPUT) {
        Serial.println("ERROR SET PIN_NOT_OUTPUT");
      } else if (level.equalsIgnoreCase("HIGH")) {
        setDigitalState(pin, HIGH);
        Serial.println("OK SET " + String(pin) + " HIGH");
      } else if (level.equalsIgnoreCase("LOW")) {
        setDigitalState(pin, LOW);
        Serial.println("OK SET " + String(pin) + " LOW");
      } else {
        Serial.println("ERROR SET INVALID_LEVEL");
      }
    } else if (partCount == 3 && parts[0].equalsIgnoreCase("MODE")) {
      int pin = parsePinNumber(parts[1]);
      String mode = parts[2];
      mode.toUpperCase();

      if (pin < 0) {
        Serial.println("ERROR MODE INVALID_PIN");
      } else if (mode.equalsIgnoreCase("OUTPUT")) {
        configurePin(pin, OUTPUT);
        Serial.println("OK MODE " + String(pin) + " OUTPUT");
      } else if (mode.equalsIgnoreCase("INPUT")) {
        configurePin(pin, INPUT);
        Serial.println("OK MODE " + String(pin) + " INPUT");
      } else if (mode.equalsIgnoreCase("INPUT_PULLUP")) {
        configurePin(pin, INPUT_PULLUP);
        Serial.println("OK MODE " + String(pin) + " INPUT_PULLUP");
      } else {
        Serial.println("ERROR MODE INVALID_MODE");
      }
    } else if (partCount == 2 && parts[0].equalsIgnoreCase("READ")) {
      int pin = parsePinNumber(parts[1]);
      if (pin < 0) {
        Serial.println("ERROR READ INVALID_PIN");
        return;
      }

      int value = readPinStateFor(pin);
      String levelLabel = (value == HIGH) ? "HIGH" : "LOW";
      Serial.println("READ " + String(pin) + " " + modeLabelFor(pin) + " " + levelLabel);
    } else if (partCount == 1 && parts[0].equalsIgnoreCase("STATUS")) {
      printStatusLine();
    } else {
      Serial.println("ERROR UNKNOWN_COMMAND");
    }
  }
}
