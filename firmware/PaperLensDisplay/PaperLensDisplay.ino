#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <Wire.h>

#include "config.h"

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define BUTTON_PIN 0

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
DynamicJsonDocument statusDocument(6144);
WiFiClient wifiClient;

String connectionError;
unsigned long lastPoll = 0;
unsigned long lastButtonChange = 0;
bool previousButtonState = HIGH;
uint8_t currentPage = 0;
const unsigned long POLL_INTERVAL_MS = 2500;
const unsigned long BUTTON_DEBOUNCE_MS = 180;

void printWrapped(String text, uint8_t maxLines) {
  const uint8_t charsPerLine = 21;
  uint8_t lines = 0;
  text.trim();

  while (text.length() > 0 && lines < maxLines) {
    int splitAt = charsPerLine;
    if (text.length() > charsPerLine) {
      int spaceAt = text.lastIndexOf(' ', charsPerLine);
      if (spaceAt > 0) splitAt = spaceAt;
    } else {
      splitAt = text.length();
    }

    display.println(text.substring(0, splitAt));
    text = text.substring(splitAt);
    text.trim();
    lines++;
  }
}

void drawMessage(const String& heading, const String& message) {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.println(heading);
  display.println();
  printWrapped(message, 6);
  display.display();
}

void drawStatusPage() {
  const char* status = statusDocument["status"] | "waiting";
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.println("PaperLens  Status");
  display.println("---------------------");

  if (strcmp(status, "waiting") == 0) {
    display.println("System ready");
    display.println("Waiting for a PDF...");
  } else if (strcmp(status, "received") == 0 || strcmp(status, "analyzing") == 0) {
    display.println("PDF received");
    display.println("Analyzing...");
    printWrapped(String(statusDocument["paper_title"] | ""), 4);
  } else if (strcmp(status, "completed") == 0) {
    display.println("Analysis complete");
    printWrapped(String(statusDocument["paper_title"] | ""), 2);
    display.print("Datasets: ");
    display.println((int)(statusDocument["dataset_count"] | 0));
    display.print("Metrics:   ");
    display.println((int)(statusDocument["metric_count"] | 0));
    display.print("Source: ");
    const char* source = statusDocument["source"] | "";
    display.println(strcmp(source, "local") == 0 ? "Local extract" : "Unknown");
  } else if (strcmp(status, "failed") == 0) {
    display.println("Analysis failed");
    printWrapped(String(statusDocument["error"] | "Unknown error"), 5);
  } else {
    display.print("Status: ");
    display.println(status);
  }
  display.display();
}

void drawTitlePage() {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.println("Paper title");
  display.println("---------------------");
  printWrapped(String(statusDocument["paper_title"] | "No paper yet"), 6);
  display.display();
}

void drawDatasetPage() {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.print("Datasets (");
  display.print((int)(statusDocument["dataset_count"] | 0));
  display.println(")");
  display.println("---------------------");
  JsonArray datasets = statusDocument["datasets"].as<JsonArray>();
  if (datasets.isNull() || datasets.size() == 0) {
    display.println("None identified");
  } else {
    for (JsonVariant dataset : datasets) {
      if (display.getCursorY() > 54) break;
      printWrapped(dataset.as<String>(), 1);
    }
  }
  display.display();
}

void drawMetricsPage() {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.print("Metrics (");
  display.print((int)(statusDocument["metric_count"] | 0));
  display.println(")");
  display.println("---------------------");
  JsonArray metrics = statusDocument["metrics"].as<JsonArray>();
  if (metrics.isNull() || metrics.size() == 0) {
    display.println("None identified");
  } else {
    for (JsonVariant metric : metrics) {
      if (display.getCursorY() > 54) break;
      String line = String(metric["name"] | "");
      String value = String(metric["value"] | "");
      if (value.length() > 0) line += ": " + value;
      printWrapped(line, 1);
    }
  }
  display.display();
}

void drawModelsPage() {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.println("Models");
  display.println("---------------------");
  JsonArray models = statusDocument["models"].as<JsonArray>();
  if (models.isNull() || models.size() == 0) {
    display.println("None identified");
  } else {
    for (JsonVariant model : models) {
      if (display.getCursorY() > 54) break;
      printWrapped(model.as<String>(), 1);
    }
  }
  display.display();
}

void drawSummaryPage() {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.println("Summary");
  display.println("---------------------");
  printWrapped(String(statusDocument["summary"] | "No summary yet"), 6);
  display.display();
}

void renderCurrentPage() {
  if (connectionError.length() > 0) {
    drawMessage("Connection problem", connectionError);
    return;
  }

  switch (currentPage) {
    case 1:
      drawTitlePage();
      break;
    case 2:
      drawDatasetPage();
      break;
    case 3:
      drawMetricsPage();
      break;
    case 4:
      drawModelsPage();
      break;
    case 5:
      drawSummaryPage();
      break;
    default:
      drawStatusPage();
      break;
  }
}

void fetchStatus() {
  if (WiFi.status() != WL_CONNECTED) {
    connectionError = "Wi-Fi disconnected. Reconnecting...";
    WiFi.reconnect();
    renderCurrentPage();
    return;
  }

  HTTPClient http;
  http.setTimeout(3000);
  http.begin(wifiClient, PAPERLENS_STATUS_URL);
  http.addHeader("X-Device-Token", PAPERLENS_DEVICE_TOKEN);
  int responseCode = http.GET();

  if (responseCode == HTTP_CODE_OK) {
    String response = http.getString();
    DeserializationError error = deserializeJson(statusDocument, response);
    if (error) {
      connectionError = "Invalid status data from PaperLens.";
    } else {
      connectionError = "";
    }
  } else if (responseCode == 401) {
    connectionError = "Device token rejected. Check config.";
  } else if (responseCode > 0) {
    connectionError = "PaperLens API HTTP " + String(responseCode);
  } else {
    connectionError = "PaperLens API unavailable. Retrying...";
  }

  http.end();
  renderCurrentPage();
}

void checkButton() {
  bool buttonState = digitalRead(BUTTON_PIN);
  unsigned long now = millis();
  if (buttonState != previousButtonState && now - lastButtonChange >= BUTTON_DEBOUNCE_MS) {
    lastButtonChange = now;
    previousButtonState = buttonState;
    if (buttonState == LOW) {
      currentPage = (currentPage + 1) % 6;
      renderCurrentPage();
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println("SSD1306 initialization failed");
    while (true) delay(1000);
  }
  drawMessage("PaperLens", "Starting up...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  drawMessage("PaperLens", "Connecting to Wi-Fi...");
}

void loop() {
  checkButton();
  unsigned long now = millis();
  if (now - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = now;
    fetchStatus();
  }
  delay(10);
}
