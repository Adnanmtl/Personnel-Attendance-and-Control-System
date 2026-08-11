#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// Pin definitions for Worker Entry Reader
#define ENTRY_RST_PIN   4
#define ENTRY_SS_PIN    5

// Pin definitions for Worker Exit Reader
#define EXIT_RST_PIN    17
#define EXIT_SS_PIN     16 
#define BUZZER_PIN 15 

// --- Wi-Fi Settings ---
const char* ssid = "YOUR_SSID";          // Change to your Wi-Fi name
const char* password = "YOUR_PASSWORD";  // Change to your Wi-Fi password

// Maximum time to wait for a connection (5000 milliseconds = 5 seconds)
const unsigned long WIFI_TIMEOUT_MS = 5000;

// --- API Configuration ---
const char* api_url = "http://localhost:3000/api/v1/request";
const String DEVICE_SERIAL = "CDS-A3-001"; // Doesn't matter just give your device a name
const String FIRMWARE_VER = "1.1.1"; // same as above


MFRC522 entryReader(ENTRY_SS_PIN, ENTRY_RST_PIN);
MFRC522 exitReader(EXIT_SS_PIN, EXIT_RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2); 

// Define a structure to hold Worker Data
struct Worker {
  String uid;
  String firstName;
  String lastName;
};

const int MAX_WORKERS = 10;
Worker database[MAX_WORKERS];
int registeredCount = 0;

void setup() {
  Serial.begin(115200);
  SPI.begin();
  
  // Initialize Entry Reader
  entryReader.PCD_Init();
  Serial.println(F("Entry Reader Initialized."));

  // Initialize Exit Reader
  exitReader.PCD_Init();
  Serial.println(F("Exit Reader Initialized."));
  pinMode(BUZZER_PIN, OUTPUT);
  
  // Initialize LCD
  lcd.init();
  lcd.backlight();
  
  // Connect to Wi-Fi Network
  connectToWiFi();
  displayReadyMessage();
}

void loop() {
  String DEVICE_Direction = "";
  String currentUID="";
  // Maintain Wi-Fi Connection
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }
  
  // 1. Check for Registration Trigger
  if (Serial.available() > 0) {
    char input = Serial.read();
    if (input == 'R' || input == 'r') {
      handleRegistration();
    }
  }
  
  // 2. Normal Attendance Mode (Look for cards)
  if (entryReader.PICC_IsNewCardPresent() && entryReader.PICC_ReadCardSerial()) {
    Serial.print(F("[ENTRY] Worker detected! ID: "));
    currentUID = getUIDString(entryReader.uid.uidByte, entryReader.uid.size);
    DEVICE_Direction = "in";
    Serial.println(currentUID);
    // Halt PICC and stop encryption on PCD
    entryReader.PICC_HaltA();
    entryReader.PCD_StopCrypto1();
  }else if (exitReader.PICC_IsNewCardPresent() && exitReader.PICC_ReadCardSerial()) {
    Serial.print(F("[EXIT] Worker detected! ID: "));
    currentUID = getUIDString(exitReader.uid.uidByte, exitReader.uid.size);
    DEVICE_Direction = "out";
    Serial.println(currentUID);
    // Halt PICC and stop encryption on PCD
    exitReader.PICC_HaltA();
    exitReader.PCD_StopCrypto1();
  } else { return; }

  // Extract the Card UID string (without spaces)
  int workerIndex = findWorker(currentUID);
  
  lcd.clear();
  if (workerIndex != -1) {
    // Worker Found!
    Serial.println("Access Granted: " + database[workerIndex].firstName + " " + database[workerIndex].lastName);
    
    // Print to 16x2 LCD
    lcd.setCursor(0, 0);
    lcd.print(database[workerIndex].firstName);
    lcd.setCursor(0, 1);
    lcd.print(database[workerIndex].lastName);
    
    beep(2000, 200); // Success tone
  } else {
    // Unknown Tag
    Serial.println("Access Denied: Unregistered Tag (" + currentUID + ")");
    
    lcd.setCursor(0, 0);
    lcd.print("Access Denied");
    lcd.setCursor(0, 1);
    lcd.print("Unknown Tag");
    
    beep(500, 500); // Error tone
  }

  // Send data to the remote server
  sendAttendanceData(currentUID, DEVICE_Direction);
  
  delay(2000); // Prevent rapid accidental double-scans
  displayReadyMessage();
}

// --- Helper Functions ---

void connectToWiFi() {
  lcd.clear();
  lcd.print("Connecting WiFi");
  Serial.print("Connecting to Wi-Fi");

  // Set Wi-Fi to station mode and begin the connection process
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  unsigned long startAttemptTime = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < WIFI_TIMEOUT_MS) {
    delay(200);
    Serial.print(".");
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\n[TIMEOUT] WiFi failed to connect within 5 seconds.");
    Serial.println("Retrying connection immediately...\n");
    lcd.clear();
    lcd.print("Trying again!");
    
    WiFi.disconnect(); // Clear out the previous attempt state
    delay(500);        // Brief stabilization pause before the next attempt
    connectToWiFi();   // Recursively try connecting again
  } else {
    Serial.println("\n[SUCCESS] WiFi Connected!");
    lcd.clear();
    lcd.print("WiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  }
  delay(1000);
}

// Convert byte array UID to formatted string
String getUIDString(byte *buffer, byte bufferSize) {
  String uidStr = "";
  for (byte i = 0; i < bufferSize; i++) {
    // Add a leading zero if the byte value is less than 16 (0x10)
    if (buffer[i] < 0x10) {
      uidStr += "0";
    }
    uidStr += String(buffer[i], HEX);
  }
  uidStr.toUpperCase();
  return uidStr;
}

void sendAttendanceData(String currentUID, String DEVICE_Direction) {
  WiFiClientSecure client;
  client.setInsecure(); // Allows HTTPS communication without uploading SSL certificates
  
  HTTPClient http;
  http.begin(client, api_url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", "YOUR_API_KEY");
  
  // Fetch local IP assigned to the ESP32
  String currentIP = WiFi.localIP().toString();
  
  // Construct your exact JSON formatting payload
  String jsonPayload = "{\"card_id\":\"" + currentUID + "\",";
  jsonPayload += "\"direction\":\"" + DEVICE_Direction + "\",";
  jsonPayload += "\"serial\":\"" + DEVICE_SERIAL + "\",";
  jsonPayload += "\"ip\":\"" + currentIP + "\",";
  jsonPayload += "\"fw\":\"" + FIRMWARE_VER + "\"}";
  
  lcd.clear();
  lcd.print("Sending Scan...");
  Serial.println("Sending JSON: " + jsonPayload);

  http.GET();
  

  int httpResponseCode = http.POST(jsonPayload);
  
  if (httpResponseCode > 0) {
    String responseString = http.getString();
    Serial.println("HTTP Code: " + String(httpResponseCode));
    Serial.println("API Response: " + responseString);
    
    // API accepted the request successfully
    if (httpResponseCode == 200 || httpResponseCode == 201) {
      lcd.clear();
      lcd.print("Scan Received!");
      lcd.setCursor(0, 1);
      lcd.print("ID: " + currentUID);
      beep(2000, 200); 
    } else {
      // Server returned a structural rejection error code
      lcd.clear();
      lcd.print("Access Denied");
      lcd.setCursor(0, 1);
      lcd.print("Code: " + String(httpResponseCode));
      beep(500, 500); 
    }
  } else {
    // Network physical drops or routing failures
    Serial.println("Error sending POST request: " + String(httpResponseCode));
    lcd.clear();
    lcd.print("Server Timeout");
    beep(500, 500);
  }
  
  http.end(); 
}

void handleRegistration() {
  if (registeredCount >= MAX_WORKERS) {
    Serial.println("\nError: Database full!");
    return;
  }

  Serial.println("\n*** STARTING REGISTRATION ***");
  lcd.clear();
  lcd.print("Registering...");

  // Flush any leftover characters in serial buffer
  while(Serial.available() > 0) Serial.read(); 

  // Get First Name
  Serial.print("Enter Worker's First Name: ");
  while (Serial.available() == 0) {} // Wait for input
  String fName = Serial.readStringUntil('\n');
  fName.trim();
  Serial.println(fName);

  // Get Surname
  Serial.print("Enter Worker's Surname: ");
  while (Serial.available() == 0) {} // Wait for input
  String lName = Serial.readStringUntil('\n');
  lName.trim();
  Serial.println(lName);

  // Prompt for Card Swipe
  Serial.println("Now, scan the RFID tag to pair with " + fName + " " + lName + "...");
  lcd.setCursor(0, 1);
  lcd.print("Scan card now...");

  // Blocking loop waiting specifically for a card to be swiped
  while (true) {
    if (entryReader.PICC_IsNewCardPresent() && entryReader.PICC_ReadCardSerial()) {
      String newUID = getUIDString(entryReader.uid.uidByte, entryReader.uid.size);
      
      if (findWorker(newUID) != -1) {
        Serial.println("Error: This card belongs to someone else. Registration cancelled.");
        lcd.clear();
        lcd.print("Card Already Used");
        beep(500, 500);
        delay(2000);
        break;
      }

      // Save everything into our structural database array
      database[registeredCount].uid = newUID;
      database[registeredCount].firstName = fName;
      database[registeredCount].lastName = lName;
      registeredCount++;

      Serial.println("Success! Profile created for " + fName + " " + lName);
      
      lcd.clear();
      lcd.print("Registered!");
      lcd.setCursor(0, 1);
      lcd.print(fName + " " + lName);
      
      beep(2000, 100); delay(50); beep(2000, 100); // Success double-beep
      delay(2000);
      break; 
    }
    delay(50); // Small delay to keep watch dog timer happy
  }

  entryReader.PICC_HaltA();
  entryReader.PCD_StopCrypto1();
  displayReadyMessage();
}

// Search database for matching UID, returns index or -1 if not found
int findWorker(String uid) {
  for (int i = 0; i < registeredCount; i++) {
    if (database[i].uid == uid) {
      return i; 
    }
  }
  return -1; 
}

void displayReadyMessage() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Cevher Digital");
  lcd.setCursor(0, 1);
  lcd.print("Ready to Scan...");
}

void beep(int frequency, int duration) {
  tone(BUZZER_PIN, frequency, duration);
  delay(duration);
  noTone(BUZZER_PIN);
}