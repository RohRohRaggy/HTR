// Two-lane race timer: GPIO 18 is Lane 1 and GPIO 19 is Lane 2.
// Both inputs are active-HIGH; the first trigger starts the race clock.
// Later triggers emit LANE,<lane>,<lap count>,<last ms>,<best ms>.
#include <string.h>

const byte laneCount = 2;
const byte sensorPins[laneCount] = {18, 19};
const unsigned long triggerDebounceMs = 1000;

bool previousSensorState[laneCount] = {false, false};
unsigned long lastSensorTrigger[laneCount] = {0, 0};
unsigned long lastLapTime[laneCount] = {0, 0};
unsigned long lapCount[laneCount] = {0, 0};
unsigned long bestLap[laneCount] = {0, 0};

bool raceStarted = false;
unsigned long raceStartTime = 0;
unsigned long lastHeartbeat = 0;

void resetRaceState() {
raceStarted = false;
raceStartTime = 0;

for (byte lane = 0; lane < laneCount; lane++) {
previousSensorState[lane] = digitalRead(sensorPins[lane]) == HIGH;
lastSensorTrigger[lane] = 0;
lastLapTime[lane] = 0;
lapCount[lane] = 0;
bestLap[lane] = 0;
}
}

// Accept a RESET command so false starts can restart the timing state.
void processSerialCommands() {
static char command[16];
static byte commandLength = 0;

while (Serial.available() > 0) {
char incoming = Serial.read();

if (incoming == '\n') {
command[commandLength] = '\0';
if (strcmp(command, "RESET") == 0) {
resetRaceState();
Serial.println("RESET:OK");
}
commandLength = 0;
} else if (incoming != '\r' && commandLength < sizeof(command) - 1) {
command[commandLength++] = incoming;
}
}
}

// Configure the finish-line inputs and start serial communication.
void setup() {
for (byte lane = 0; lane < laneCount; lane++) {
pinMode(sensorPins[lane], INPUT);
}

Serial.begin(115200);

Serial.println("SYSTEM:READY");
}

void loop() {

unsigned long currentTime = millis();
processSerialCommands();

// Report periodic GPIO levels to help diagnose sensor wiring.
if (currentTime - lastHeartbeat >= 1000) {
lastHeartbeat = currentTime;

Serial.print("HEARTBEAT:");
Serial.print(currentTime);
for (byte lane = 0; lane < laneCount; lane++) {
Serial.print(",GPIO");
Serial.print(sensorPins[lane]);
Serial.print("=");
Serial.print(digitalRead(sensorPins[lane]) == HIGH ? "HIGH" : "LOW");
}
Serial.println();
}

// Detect active-HIGH rising edges and debounce each lane independently.
bool triggeredLanes[laneCount] = {false, false};

for (byte lane = 0; lane < laneCount; lane++) {
bool rawSensorIsHigh = digitalRead(sensorPins[lane]) == HIGH;
if (rawSensorIsHigh != previousSensorState[lane]) {
Serial.print("INPUT,LANE,");
Serial.print(lane + 1);
Serial.print(",GPIO,");
Serial.print(sensorPins[lane]);
Serial.print(",");
Serial.println(rawSensorIsHigh ? "HIGH" : "LOW");
}

bool sensorIsActive = rawSensorIsHigh;
bool risingEdge = sensorIsActive && !previousSensorState[lane];
previousSensorState[lane] = rawSensorIsHigh;

if (risingEdge && (lastSensorTrigger[lane] == 0
|| currentTime - lastSensorTrigger[lane] >= triggerDebounceMs)) {
triggeredLanes[lane] = true;
lastSensorTrigger[lane] = currentTime;
}
}

bool anyLaneTriggered = triggeredLanes[0] || triggeredLanes[1];
// The first accepted trigger from either lane starts the shared race timer.
if (!raceStarted && anyLaneTriggered) {
raceStarted = true;
raceStartTime = currentTime;

for (byte lane = 0; lane < laneCount; lane++) {
lastLapTime[lane] = raceStartTime;
}

Serial.println("START");
return;
}

for (byte lane = 0; lane < laneCount; lane++) {
if (!triggeredLanes[lane]) continue;

// Update this lane's lap statistics and send its lane ID to the dashboard.
unsigned long lapTime = currentTime - lastLapTime[lane];
lastLapTime[lane] = currentTime;
lapCount[lane]++;

if (bestLap[lane] == 0 || lapTime < bestLap[lane]) {
bestLap[lane] = lapTime;
}

Serial.print("LANE,");
Serial.print(lane + 1);
Serial.print(",");
Serial.print(lapCount[lane]);
Serial.print(",");
Serial.print(lapTime);
Serial.print(",");
Serial.println(bestLap[lane]);
}
}