// Race state, lane records, and dashboard element references.
let activePort = null;
let activeReader = null;
let lapTarget = 50;
let lapDistanceMeters = 0;
let dashboardInitialized = false;
let awaitingInitialConnection = false;
let startSequenceTimer = null;
let startSequenceActive = false;
let startAllowed = false;
let pendingResetResolve = null;
let currentLapCount = 0;
let currentRawLapCount = 0;
let lapCountOffset = 0;
let raceStarted = false;
let finishScreenShown = false;
let crossingSequence = 0;
let configuredLaneCount = 2;
const maxLaneCount = 32;
const startLightIntervalMs = 900;
const firstStartLightDelayMs = 500;
let raceStartedAt = 0;
let raceTimerInterval = null;
let laneDataReceived = false;
const laneRecords = new Map();

const connectionStatus = document.getElementById("connectionStatus");
const connectButton = document.getElementById("connectButton");
const disconnectButton = document.getElementById("disconnectButton");
const raceStatus = document.getElementById("raceStatus");
const highestSpeed = document.getElementById("highestSpeed");
const lapDistanceDetail = document.getElementById("lapDistance");
const weatherValue = document.getElementById("weather");
const weatherCondition = document.getElementById("weatherCondition");
const weatherButton = document.getElementById("weatherButton");
const cameraForm = document.getElementById("cameraConnectForm");
const cameraUrlInput = document.getElementById("cameraUrl");
const cameraFeed = document.getElementById("cameraFeed");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const cameraStatus = document.getElementById("cameraStatus");
const cameraStorageKey = "raceCameraStreamUrl";
const menuToggle = document.getElementById("menuToggle");
const menuPanel = document.getElementById("raceMenu");
const dashboard = document.getElementById("dashboard");
const startScreen = document.getElementById("startScreen");
const raceSetupForm = document.getElementById("raceSetupForm");
const setupLapTarget = document.getElementById("setupLapTarget");
const setupLaneCount = document.getElementById("setupLaneCount");
const setupLapDistance = document.getElementById("setupLapDistance");
const setupError = document.getElementById("setupError");
const cancelSetupButton = document.getElementById("cancelSetupButton");
const connectionScreen = document.getElementById("connectionScreen");
const setupConnectionStatus = document.getElementById("setupConnectionStatus");
const connectBeforeStartButton = document.getElementById("connectBeforeStartButton");
const raceStart = document.getElementById("raceStart");
const finishScreen = document.getElementById("finishScreen");
const finishSummary = document.getElementById("finishSummary");
const finishResultsBody = document.getElementById("finishResultsBody");
const startLightBox = document.querySelector(".start-light-box");
const startLightsEyebrow = document.getElementById("startLightsEyebrow");
const startLightsStatus = document.getElementById("startLightsStatus");
const startLightColumns = Array.from(document.querySelectorAll(".start-light-column"));
const falseStartDetail = document.getElementById("falseStartDetail");
const retryStartButton = document.getElementById("retryStartButton");
let weatherLocation = null;
let weatherRefreshTimer = null;
let cameraRefreshTimer = null;
const soundcloudPlayerFrame = document.getElementById("soundcloudPlayer");
let soundcloudWidget = null;
let soundcloudWidgetReady = false;
let soundcloudStartRequested = false;
let soundcloudPlaybackCheckTimer = null;
let soundcloudStartSyncCallback = null;
let soundcloudPlaybackWasLate = false;
let soundcloudPlayIssued = false;

function closeMenu(){
menuPanel.hidden = true;
menuToggle.setAttribute("aria-expanded", "false");
}

function loadSoundCloudWidget(){
if(window.SC){
initializeSoundCloudWidget();
return;
}

const sdkScript = document.createElement("script");
sdkScript.src = "https://w.soundcloud.com/player/api.js";
sdkScript.onload = initializeSoundCloudWidget;
sdkScript.onerror = () => {
document.getElementById("soundcloudStatus").innerText = "Could not load the SoundCloud player.";
};
document.head.append(sdkScript);
}

function initializeSoundCloudWidget(){
if(soundcloudWidget || !window.SC) return;

soundcloudWidget = window.SC.Widget(soundcloudPlayerFrame);
soundcloudWidget.bind(window.SC.Widget.Events.READY, () => {
soundcloudWidgetReady = true;
document.getElementById("soundcloudStatus").innerText = "Ready. If autoplay is blocked, press play here once.";
if(soundcloudStartRequested) requestSoundCloudPlayback();
});
soundcloudWidget.bind(window.SC.Widget.Events.PLAY, () => {
if(soundcloudPlaybackCheckTimer !== null){
window.clearTimeout(soundcloudPlaybackCheckTimer);
soundcloudPlaybackCheckTimer = null;
}
if(soundcloudPlaybackWasLate){
soundcloudPlaybackWasLate = false;
soundcloudStartRequested = false;
soundcloudWidget.pause();
soundcloudWidget.seekTo(0);
document.getElementById("soundcloudStatus").innerText = "SoundCloud started too late, so it was stopped to keep the lights in sync.";
return;
}
document.getElementById("soundcloudStatus").innerText = "SoundCloud start sound playing.";
if(soundcloudStartSyncCallback){
const onStarted = soundcloudStartSyncCallback;
soundcloudStartSyncCallback = null;
onStarted();
}
});
soundcloudWidget.bind(window.SC.Widget.Events.PAUSE, () => {
document.getElementById("soundcloudStatus").innerText = "SoundCloud start sound paused.";
});
soundcloudWidget.bind(window.SC.Widget.Events.FINISH, () => {
soundcloudStartRequested = false;
document.getElementById("soundcloudStatus").innerText = "SoundCloud start sound finished.";
});
}

function requestSoundCloudPlayback(){
if(!soundcloudStartRequested || !soundcloudWidgetReady || !soundcloudWidget || soundcloudPlayIssued) return;
soundcloudPlayIssued = true;
soundcloudWidget.seekTo(0);
soundcloudWidget.play();
}

function playSoundCloudStart(onStarted){
soundcloudStartRequested = true;
soundcloudPlaybackWasLate = false;
soundcloudPlayIssued = false;
soundcloudStartSyncCallback = onStarted;
if(soundcloudPlaybackCheckTimer !== null) window.clearTimeout(soundcloudPlaybackCheckTimer);
soundcloudPlaybackCheckTimer = window.setTimeout(() => {
soundcloudPlaybackCheckTimer = null;
soundcloudPlaybackWasLate = soundcloudPlayIssued;
soundcloudStartRequested = false;
document.getElementById("soundcloudStatus").innerText = "SoundCloud did not start in time; continuing with the lights.";
const continueStart = soundcloudStartSyncCallback;
soundcloudStartSyncCallback = null;
if(continueStart) continueStart();
}, 1800);
requestSoundCloudPlayback();
}

function stopSoundCloudStart(){
soundcloudStartRequested = false;
soundcloudStartSyncCallback = null;
soundcloudPlaybackWasLate = false;
soundcloudPlayIssued = false;
if(soundcloudPlaybackCheckTimer !== null){
window.clearTimeout(soundcloudPlaybackCheckTimer);
soundcloudPlaybackCheckTimer = null;
}
if(!soundcloudWidgetReady || !soundcloudWidget) return;
soundcloudWidget.pause();
soundcloudWidget.seekTo(0);
}

// Open the ESP32 serial port and process complete newline-delimited messages.
async function connect(){
if(!("serial" in navigator)){
connectionStatus.innerText = "Web Serial is not supported in this browser";
if(awaitingInitialConnection){
setupConnectionStatus.innerText = "Web Serial is not supported in this browser. Try Chrome or Edge.";
}
connectBeforeStartButton.disabled = false;
return;
}

let port;
let reader;
let pipePromise;

try{
port = await navigator.serial.requestPort();
await port.open({baudRate:115200});
activePort = port;

const decoder = new TextDecoderStream();
pipePromise = port.readable.pipeTo(decoder.writable);
pipePromise.catch(() => {});
reader = decoder.readable.getReader();
activeReader = reader;

connectionStatus.innerText = "Connected; waiting for data...";
connectButton.disabled = true;
disconnectButton.disabled = false;
if(awaitingInitialConnection){
awaitingInitialConnection = false;
dashboardInitialized = true;
setupConnectionStatus.innerText = "ESP32 connected. Starting lights...";
connectBeforeStartButton.disabled = true;
startRaceLights();
}

let buffer = "";
while(true){
const {value, done} = await reader.read();
if(done) break;

buffer += value;
const lines = buffer.split("\n");
buffer = lines.pop();

for(const rawLine of lines){
const line = rawLine.trim();
if(!line) continue;

updateRaceData(line);
}
}
}catch(error){
if(error.name !== "NotFoundError"){
connectionStatus.innerText = `Connection error: ${error.message}`;
if(awaitingInitialConnection){
setupConnectionStatus.innerText = `Could not connect: ${error.message}`;
}
}else if(awaitingInitialConnection){
setupConnectionStatus.innerText = "Port selection cancelled. Connect the ESP32 to begin.";
}
}finally{
if(reader){
reader.releaseLock();
}
if(pipePromise){
await pipePromise.catch(() => {});
}
if(port && port === activePort){
activePort = null;
activeReader = null;
try{
await port.close();
}catch(error){
connectionStatus.innerText = `Disconnect error: ${error.message}`;
}
}
connectButton.disabled = false;
disconnectButton.disabled = true;
connectBeforeStartButton.disabled = false;
if(connectionStatus.innerText.startsWith("Connected")){
connectionStatus.innerText = "Disconnected";
if(awaitingInitialConnection){
setupConnectionStatus.innerText = "Connection closed. Connect the ESP32 to begin.";
}
}
}
}

async function disconnect(){
if(activeReader){
connectionStatus.innerText = "Disconnecting...";
await activeReader.cancel();
}
}

// Route start, lane-specific, and legacy race-wide serial messages.
function updateRaceData(line){
if(line === "RESET:OK"){
if(pendingResetResolve !== null){
pendingResetResolve();
pendingResetResolve = null;
}
return;
}

if(finishScreenShown) return;

if(startSequenceActive && !startAllowed && isSensorTriggerMessage(line)){
showFalseStart();
return;
}

if(line === "START" || line.startsWith("START,")){
startRace();
return;
}

if(line.startsWith("LANE,")){
updateLaneRaceData(line);
return;
}

if(!line.startsWith("LAP,")) return;

const parts = line.split(",");
if(parts.length < 5) return;

const lapCount = Number(parts[1]);
const lastLap = Number(parts[2]);
const bestLap = Number(parts[3]);
if(![lapCount, lastLap, bestLap].every(Number.isFinite)) return;

if(!raceStarted){
startRace(lapCount);
return;
}

currentRawLapCount = Math.max(lapCount - lapCountOffset, 0);
currentLapCount = Math.min(lapTarget, currentRawLapCount);
const laneOne = laneRecords.get(1);
if(laneOne){
laneOne.laps = currentLapCount;
laneOne.rawLaps = currentRawLapCount;
laneOne.lastCrossingSequence = ++crossingSequence;
if(currentRawLapCount <= lapTarget){
laneOne.lastLapMs = lastLap;
laneOne.bestLapMs = bestLap;
recordLaneFinish(laneOne);
document.getElementById("bestLap").innerText = `${(bestLap / 1000).toFixed(3)} s`;
}
laneOne.hasData = true;
}
renderLeaderboard();
updateSpeedMetrics();
updateLapsToGo();
updateRaceCompletion();
}

function isSensorTriggerMessage(line){
return line === "START" || line.startsWith("START,")
|| line.startsWith("LANE,") || line.startsWith("LAP,");
}

// Update one lane from a LANE,id,laps,lastMs,bestMs record.
function updateLaneRaceData(line){
const parts = line.split(",");
if(parts.length < 5) return;

const laneId = Number(parts[1]);
const reportedLaps = Number(parts[2]);
const lastLapMs = Number(parts[3]);
const bestLapMs = Number(parts[4]);
const lane = laneRecords.get(laneId);
if(!lane || !Number.isInteger(reportedLaps) || reportedLaps < 0) return;
if(![lastLapMs, bestLapMs].every(Number.isFinite) || lastLapMs < 0 || bestLapMs < 0) return;

laneDataReceived = true;
lane.hasData = true;
lane.lastCrossingSequence = ++crossingSequence;
if(!raceStarted){
startRace();
lane.lapBaseline = reportedLaps;
lane.rawLaps = 0;
renderLeaderboard();
updateSpeedMetrics();
updateLapsToGo();
return;
}

if(lane.lapBaseline === null) lane.lapBaseline = 0;
lane.rawLaps = Math.max(reportedLaps - lane.lapBaseline, 0);
lane.laps = Math.min(lapTarget, lane.rawLaps);
if(lane.rawLaps <= lapTarget){
lane.lastLapMs = lastLapMs;
lane.bestLapMs = bestLapMs;
recordLaneFinish(lane);
}

const bestTimes = Array.from(laneRecords.values())
.filter(record => record.id <= configuredLaneCount && record.bestLapMs > 0)
.map(record => record.bestLapMs);
if(bestTimes.length){
document.getElementById("bestLap").innerText = `${(Math.min(...bestTimes) / 1000).toFixed(3)} s`;
}

renderLeaderboard();
updateSpeedMetrics();
updateLapsToGo();
updateRaceCompletion();
}

// Sort active lanes and render their timing, delta, speed, and status cells.
function renderLeaderboard(){
const activeLanes = Array.from(laneRecords.values())
.filter(lane => lane.id <= configuredLaneCount)
.sort((left, right) => right.laps - left.laps
|| (right.lastCrossingSequence ?? -Infinity) - (left.lastCrossingSequence ?? -Infinity)
|| left.id - right.id);
const rowPositions = new Map(activeLanes.map(lane => {
const row = document.querySelector(`.lane-row[data-lane="${lane.id}"]`);
return [row, row.getBoundingClientRect().top];
}));
const lastLapTimes = activeLanes.filter(lane => Number.isFinite(lane.lastLapMs)).map(lane => lane.lastLapMs);
const bestLapTimes = activeLanes.filter(lane => Number.isFinite(lane.bestLapMs)).map(lane => lane.bestLapMs);
const fastestLastLap = Math.min(...lastLapTimes);
const fastestBestLap = Math.min(...bestLapTimes);

activeLanes.forEach((lane, index) => {
const row = document.querySelector(`.lane-row[data-lane="${lane.id}"]`);
document.getElementById("leaderboardBody").append(row);
row.querySelector(".lane-position").innerText = index + 1;
row.querySelector(".lane-laps").innerText = lane.laps;
row.querySelector(".lane-last").innerText = formatLapTime(lane.lastLapMs);
row.querySelector(".lane-last-delta").innerText = Number.isFinite(lane.lastLapMs)
? formatLapTime(lane.lastLapMs - fastestLastLap)
: "--.---";
row.querySelector(".lane-best").innerText = formatLapTime(lane.bestLapMs);
row.querySelector(".lane-best-delta").innerText = Number.isFinite(lane.bestLapMs)
? formatLapTime(lane.bestLapMs - fastestBestLap)
: "--.---";
lane.speedKmh = speedFromLapTime(lane.lastLapMs);
row.querySelector(".lane-speed").innerText = Number.isFinite(lane.speedKmh) ? lane.speedKmh.toFixed(1) : "--";
row.querySelector(".lane-status").innerText = lane.laps >= lapTarget
? "Finished"
: lane.hasData ? "Racing" : "Ready";
});

if(!window.matchMedia("(prefers-reduced-motion: reduce)").matches){
rowPositions.forEach((previousTop, row) => {
const verticalShift = previousTop - row.getBoundingClientRect().top;
if(Math.abs(verticalShift) < 1) return;
row.animate([
{transform:`translateY(${verticalShift}px)`},
{transform:"translateY(0)"}
], {duration:420, easing:"ease-out"});
});
}
}

function speedFromLapTime(lapTimeMs){
if(lapDistanceMeters <= 0 || !Number.isFinite(lapTimeMs) || lapTimeMs <= 0) return null;
return lapDistanceMeters * 3600 / lapTimeMs;
}

function updateSpeedMetrics(){
const fastestLapMs = Array.from(laneRecords.values())
.filter(lane => lane.id <= configuredLaneCount && Number.isFinite(lane.bestLapMs) && lane.bestLapMs > 0)
.reduce((fastest, lane) => Math.min(fastest, lane.bestLapMs), Infinity);
const speedKmh = speedFromLapTime(fastestLapMs);
highestSpeed.innerText = Number.isFinite(speedKmh) ? `${speedKmh.toFixed(1)} km/h` : "--";
lapDistanceDetail.innerText = lapDistanceMeters > 0
? `Lap distance: ${lapDistanceMeters} m`
: "Lap distance not set";
}

// Create an editable row when the configured lane count increases.
function createLaneRow(laneId){
const row = document.createElement("tr");
row.className = "lane-row";
row.dataset.lane = laneId;

const position = document.createElement("td");
position.className = "lane-position";
position.innerText = laneId;
row.append(position);

for(const field of ["number", "driver"]){
const cell = document.createElement("td");
const input = document.createElement("input");
input.className = field === "number" ? "lane-number" : "lane-driver";
input.dataset.field = field;
input.type = "text";
input.maxLength = field === "number" ? 5 : 24;
input.value = field === "number" ? String(laneId) : `Lane ${laneId}`;
input.setAttribute("aria-label", `Lane ${laneId} ${field === "number" ? "car number" : "driver name"}`);
cell.append(input);
row.append(cell);
}

const cells = [
["lane-laps", "0"], ["lane-last", "--.---"], ["lane-last-delta", "--.---"],
["lane-best", "--.---"], ["lane-best-delta", "--.---"], ["lane-speed", "--"],
["lane-status", "Ready"]
];

cells.forEach(([className, value]) => {
const cell = document.createElement("td");
cell.className = className;
cell.innerText = value;
row.append(cell);
});

return row;
}

function ensureLaneRows(){
const leaderboardBody = document.getElementById("leaderboardBody");
for(let laneId = 1; laneId <= maxLaneCount; laneId++){
if(!laneRecords.has(laneId)){
laneRecords.set(laneId, {
id:laneId,
laps:0,
rawLaps:0,
lastLapMs:null,
bestLapMs:null,
finishTimeMs:null,
lastCrossingSequence:null,
lapBaseline:null,
speedKmh:null,
hasData:false
});
}

if(!leaderboardBody.querySelector(`.lane-row[data-lane="${laneId}"]`)){
leaderboardBody.append(createLaneRow(laneId));
}
}
}

function formatLapTime(milliseconds){
return Number.isFinite(milliseconds) ? (milliseconds / 1000).toFixed(3) : "--.---";
}

// Start the local race clock on the first accepted trigger.
function startRace(lapCountBaseline = 0){
if(raceStarted) return;

raceStarted = true;
lapCountOffset = lapCountBaseline;
currentLapCount = 0;
raceStartedAt = performance.now();
document.getElementById("raceTime").innerText = "0.0 s";
raceStatus.innerText = "Race started";
raceTimerInterval = window.setInterval(updateRaceTimer, 100);
updateLapsToGo();
}

function updateRaceTimer(){
const elapsedSeconds = (performance.now() - raceStartedAt) / 1000;
document.getElementById("raceTime").innerText = `${elapsedSeconds.toFixed(1)} s`;
}

function stopRaceTimer(){
updateRaceTimer();
if(raceTimerInterval !== null){
window.clearInterval(raceTimerInterval);
raceTimerInterval = null;
}
}

function updateLapsToGo(){
let leaderLaps;
if(laneDataReceived){
leaderLaps = Math.max(0, ...Array.from(laneRecords.values())
.filter(lane => lane.id <= configuredLaneCount)
.map(lane => lane.laps));
}else{
leaderLaps = currentLapCount;
}

document.getElementById("lapsToGo").innerText = lapTarget > 0
? `${Math.min(Math.max(leaderLaps, 0), lapTarget)}/${lapTarget}`
: "--";
}

function updateRaceCompletion(){
const raceComplete = laneDataReceived
? Array.from(laneRecords.values())
.some(lane => lane.id <= configuredLaneCount && lane.rawLaps > lapTarget)
: currentRawLapCount > lapTarget;

if(raceComplete){
raceStatus.innerText = "Race complete";
stopRaceTimer();
if(!finishScreenShown) showFinishScreen();
}else{
raceStatus.innerText = "Race in progress";
}
}

function recordLaneFinish(lane){
if(lane.laps >= lapTarget && lane.finishTimeMs === null){
lane.finishTimeMs = performance.now() - raceStartedAt;
}
}

function showFinishScreen(){
finishScreenShown = true;
const finishedLanes = Array.from(laneRecords.values())
.filter(lane => lane.id <= configuredLaneCount && (laneDataReceived ? true : lane.hasData))
.sort((left, right) => right.laps - left.laps
|| (right.lastCrossingSequence ?? -Infinity) - (left.lastCrossingSequence ?? -Infinity)
|| left.id - right.id);
finishResultsBody.replaceChildren();

finishedLanes.forEach((lane, index) => {
const row = document.createElement("tr");
const laneRow = document.querySelector(`.lane-row[data-lane="${lane.id}"]`);
const values = [
String(index + 1),
laneRow.querySelector(".lane-number").value || String(lane.id),
laneRow.querySelector(".lane-driver").value || `Lane ${lane.id}`,
String(lane.laps),
formatLapTime(lane.lastLapMs),
lane.finishTimeMs === null ? "Lapped" : formatLapTime(lane.finishTimeMs),
formatLapTime(lane.bestLapMs)
];
values.forEach(value => {
const cell = document.createElement("td");
cell.innerText = value;
row.append(cell);
});
finishResultsBody.append(row);
});

const winner = finishedLanes[0];
const winnerRow = winner ? document.querySelector(`.lane-row[data-lane="${winner.id}"]`) : null;
const winnerName = winnerRow?.querySelector(".lane-driver").value || `Lane ${winner?.id ?? ""}`;
finishSummary.innerText = `${winnerName} wins · ${winner?.laps ?? 0} laps · Last lap ${formatLapTime(winner?.lastLapMs)} s · Finish time ${formatLapTime(winner?.finishTimeMs)} s · Overall race time ${document.getElementById("raceTime").innerText}`;
dashboard.hidden = true;
finishScreen.hidden = false;
}

function returnFromFinishScreen(){
finishScreen.hidden = true;
dashboard.hidden = false;
}

function openRaceSetup(){
closeMenu();
setupLapTarget.value = String(lapTarget);
setupLaneCount.value = String(configuredLaneCount);
setupLapDistance.value = lapDistanceMeters > 0 ? String(lapDistanceMeters) : "";
setupError.hidden = true;
setupError.innerText = "";
cancelSetupButton.hidden = !dashboardInitialized;
dashboard.hidden = true;
startScreen.hidden = false;
setupLapTarget.focus();
}

function closeRaceSetup(){
startScreen.hidden = true;
dashboard.hidden = false;
}

function saveRaceSetup(event){
event.preventDefault();
const parsedLapTarget = Number(setupLapTarget.value);
const parsedLaneCount = Number(setupLaneCount.value);
const distanceText = setupLapDistance.value.trim();
const parsedLapDistance = distanceText === "" ? 0 : Number(distanceText);

if(!Number.isInteger(parsedLapTarget) || parsedLapTarget < 1){
showSetupError("Enter a whole-number lap count greater than zero.");
setupLapTarget.focus();
return;
}
if(!Number.isInteger(parsedLaneCount) || parsedLaneCount < 1 || parsedLaneCount > maxLaneCount){
showSetupError(`Enter a whole number of lanes from 1 to ${maxLaneCount}.`);
setupLaneCount.focus();
return;
}
if(distanceText !== "" && (!Number.isFinite(parsedLapDistance) || parsedLapDistance <= 0)){
showSetupError("Enter a lap distance greater than zero meters, or leave it blank.");
setupLapDistance.focus();
return;
}

try{
localStorage.setItem("raceLapTarget", String(parsedLapTarget));
localStorage.setItem("raceLaneCount", String(parsedLaneCount));
localStorage.setItem("raceLapDistanceMeters", String(parsedLapDistance));
}catch(error){
showSetupError(`Could not save race settings: ${error.message}`);
return;
}

lapTarget = parsedLapTarget;
configuredLaneCount = parsedLaneCount;
lapDistanceMeters = parsedLapDistance;
const isFirstSetup = !dashboardInitialized;
applyLaneCount();
updateSpeedMetrics();
updateLapsToGo();
if(raceStarted) updateRaceCompletion();
if(isFirstSetup){
awaitingInitialConnection = true;
startScreen.hidden = true;
connectionScreen.hidden = false;
setupConnectionStatus.innerText = "Ready to connect.";
}else{
closeRaceSetup();
}
}

function returnToRaceSetup(){
connectionScreen.hidden = true;
startScreen.hidden = false;
}

function viewDashboardWithoutESP32(){
awaitingInitialConnection = false;
dashboardInitialized = true;
connectionScreen.hidden = true;
dashboard.hidden = false;
connectionStatus.innerText = "Demo mode — ESP32 not connected";
}

function startRaceLights(){
startScreen.hidden = true;
connectionScreen.hidden = true;
dashboard.hidden = true;
raceStart.hidden = false;
startSequenceActive = true;
startAllowed = false;
startLightBox.classList.remove("false-start");
startLightsEyebrow.innerText = "GET READY";
falseStartDetail.hidden = true;
falseStartDetail.innerText = "";
retryStartButton.hidden = true;
startLightColumns.forEach(column => column.classList.remove("lit"));
startLightsStatus.innerText = "Get ready";
playSoundCloudStart(() => {
if(!startSequenceActive) return;
startSequenceTimer = window.setTimeout(() => advanceRaceStart(0), firstStartLightDelayMs);
});
}

function advanceRaceStart(lightsLit){
if(!startSequenceActive) return;
if(lightsLit === startLightColumns.length){
startLightsStatus.innerText = "All lights on";
startSequenceTimer = window.setTimeout(() => {
if(!startSequenceActive) return;
startLightColumns.forEach(column => column.classList.remove("lit"));
startAllowed = true;
startLightsStatus.innerText = "GO!";
startSequenceTimer = window.setTimeout(showRaceDashboard, 850);
}, startLightIntervalMs);
return;
}

startLightColumns[lightsLit].classList.add("lit");
startLightsStatus.innerText = `Starting lights ${lightsLit + 1} of ${startLightColumns.length}`;
startSequenceTimer = window.setTimeout(() => advanceRaceStart(lightsLit + 1), startLightIntervalMs);
}

function showFalseStart(){
if(startSequenceTimer !== null){
window.clearTimeout(startSequenceTimer);
startSequenceTimer = null;
}
startSequenceActive = false;
startAllowed = false;
stopSoundCloudStart();
startLightColumns.forEach(column => column.classList.remove("lit"));
startLightBox.classList.add("false-start");
startLightsEyebrow.innerText = "RACE CONTROL";
startLightsStatus.innerText = "FALSE START";
falseStartDetail.innerText = "The timer will be reset before the lights restart.";
falseStartDetail.hidden = false;
retryStartButton.innerText = "Reset timer & retry start";
retryStartButton.disabled = false;
retryStartButton.hidden = false;
}

async function retryAfterFalseStart(){
if(!activePort || !activePort.writable){
falseStartDetail.innerText = "ESP32 is disconnected. Reconnect it before retrying.";
return;
}

retryStartButton.disabled = true;
falseStartDetail.innerText = "Resetting the ESP32 timer...";
let writer;
let resetTimeout;
try{
const resetAcknowledged = new Promise((resolve, reject) => {
pendingResetResolve = resolve;
resetTimeout = window.setTimeout(() => {
pendingResetResolve = null;
reject(new Error("No reset acknowledgement. Upload the updated ESP32 firmware and try again."));
}, 3000);
});
writer = activePort.writable.getWriter();
await writer.write(new TextEncoder().encode("RESET\n"));
await resetAcknowledged;
}catch(error){
falseStartDetail.innerText = `Could not reset the ESP32 timer: ${error.message}`;
retryStartButton.disabled = false;
return;
}finally{
if(resetTimeout !== undefined) window.clearTimeout(resetTimeout);
pendingResetResolve = null;
if(writer) writer.releaseLock();
}

resetRaceData();
startRaceLights();
}

function resetRaceData(){
if(raceTimerInterval !== null){
window.clearInterval(raceTimerInterval);
raceTimerInterval = null;
}
raceStarted = false;
currentLapCount = 0;
currentRawLapCount = 0;
lapCountOffset = 0;
crossingSequence = 0;
laneDataReceived = false;
document.getElementById("bestLap").innerText = "--.---";
document.getElementById("raceTime").innerText = "0.0 s";
raceStatus.innerText = "Ready for first trigger";
for(const lane of laneRecords.values()){
lane.laps = 0;
lane.rawLaps = 0;
lane.lastLapMs = null;
lane.bestLapMs = null;
lane.finishTimeMs = null;
lane.lastCrossingSequence = null;
lane.lapBaseline = null;
lane.speedKmh = null;
lane.hasData = false;
}
renderLeaderboard();
updateSpeedMetrics();
updateLapsToGo();
}

function showRaceDashboard(){
if(startSequenceTimer !== null){
window.clearTimeout(startSequenceTimer);
startSequenceTimer = null;
}
startSequenceActive = false;
startLightColumns.forEach(column => column.classList.remove("lit"));
raceStart.hidden = true;
dashboard.hidden = false;
}

function showSetupError(message){
setupError.innerText = message;
setupError.hidden = false;
}

function restoreRaceSetup(){
try{
const savedLapTarget = Number(localStorage.getItem("raceLapTarget"));
const savedLaneCount = Number(localStorage.getItem("raceLaneCount"));
const savedLapDistance = Number(localStorage.getItem("raceLapDistanceMeters"));
if(Number.isInteger(savedLapTarget) && savedLapTarget > 0) lapTarget = savedLapTarget;
if(Number.isInteger(savedLaneCount) && savedLaneCount >= 1 && savedLaneCount <= maxLaneCount){
configuredLaneCount = savedLaneCount;
}
if(Number.isFinite(savedLapDistance) && savedLapDistance > 0){
lapDistanceMeters = savedLapDistance;
}
}catch(error){
showSetupError(`Could not load saved race settings: ${error.message}`);
}
setupLapTarget.value = String(lapTarget);
setupLaneCount.value = String(configuredLaneCount);
setupLapDistance.value = lapDistanceMeters > 0 ? String(lapDistanceMeters) : "";
}

function applyLaneCount(){
ensureLaneRows();
document.querySelectorAll(".lane-row").forEach(row => {
row.hidden = Number(row.dataset.lane) > configuredLaneCount;
});
renderLeaderboard();
updateSpeedMetrics();
updateLapsToGo();
}

// Persist lane labels locally so they survive a page reload.
function restoreLaneInputs(){
try{
const savedInputs = JSON.parse(localStorage.getItem("raceLaneInputs") || "{}");
document.querySelectorAll(".lane-row").forEach(row => {
const savedLane = savedInputs[row.dataset.lane];
if(!savedLane) return;
if(typeof savedLane.number === "string") row.querySelector(".lane-number").value = savedLane.number;
if(typeof savedLane.driver === "string") row.querySelector(".lane-driver").value = savedLane.driver;
});
}catch(error){
}
}

function saveLaneInputs(){
const savedInputs = {};
document.querySelectorAll(".lane-row").forEach(row => {
savedInputs[row.dataset.lane] = {
number:row.querySelector(".lane-number").value,
driver:row.querySelector(".lane-driver").value
};
});

try{
localStorage.setItem("raceLaneInputs", JSON.stringify(savedInputs));
}catch(error){
}
}

// Request browser location before loading local weather from Open-Meteo.
function requestWeatherLocation(){
if(!navigator.geolocation){
weatherCondition.innerText = "Location is not supported by this browser";
return;
}

weatherButton.disabled = true;
weatherCondition.innerText = "Waiting for location permission...";
navigator.geolocation.getCurrentPosition(position => {
weatherLocation = {
latitude: position.coords.latitude,
longitude: position.coords.longitude
};
refreshWeather();
}, error => {
const messages = {
1: "Location permission denied",
2: "Location unavailable",
3: "Location request timed out"
};
weatherCondition.innerText = messages[error.code] || "Could not get location";
weatherButton.innerText = "Try again";
weatherButton.disabled = false;
}, {enableHighAccuracy:false, timeout:15000, maximumAge:600000});
}

async function refreshWeather(){
if(!weatherLocation) return requestWeatherLocation();

weatherButton.disabled = true;
weatherCondition.innerText = "Updating weather...";

try{
const url = new URL("https://api.open-meteo.com/v1/forecast");
url.search = new URLSearchParams({
latitude: String(weatherLocation.latitude),
longitude: String(weatherLocation.longitude),
current: "temperature_2m,weather_code,wind_speed_10m",
timezone: "auto"
}).toString();

const response = await fetch(url);
if(!response.ok) throw new Error("Weather request failed");

const data = await response.json();
const current = data.current;
if(!current || !Number.isFinite(current.temperature_2m)){
throw new Error("Weather data is incomplete");
}

weatherValue.innerText = `${Math.round(current.temperature_2m)}°C`;
weatherCondition.innerText = describeWeather(current.weather_code);
if(Number.isFinite(current.wind_speed_10m)){
weatherCondition.innerText += ` · ${Math.round(current.wind_speed_10m)} km/h wind`;
}
weatherButton.innerText = "Refresh";

if(!weatherRefreshTimer){
weatherRefreshTimer = window.setInterval(refreshWeather, 10 * 60 * 1000);
}
}catch(error){
weatherCondition.innerText = "Weather unavailable";
weatherButton.innerText = "Retry";
}finally{
weatherButton.disabled = false;
}
}

function describeWeather(code){
const descriptions = {
0: "Clear sky",
1: "Mainly clear",
2: "Partly cloudy",
3: "Overcast",
45: "Fog",
48: "Freezing fog",
51: "Light drizzle",
53: "Drizzle",
55: "Heavy drizzle",
61: "Light rain",
63: "Rain",
65: "Heavy rain",
71: "Light snow",
73: "Snow",
75: "Heavy snow",
80: "Rain showers",
81: "Rain showers",
82: "Heavy rain showers",
85: "Snow showers",
86: "Heavy snow showers",
95: "Thunderstorm",
96: "Thunderstorm with hail",
99: "Thunderstorm with hail"
};
return descriptions[code] || "Current conditions";
}

// Connect to the XIAO snapshot endpoint or its optional MJPEG stream.
function connectCamera(streamUrl){
let cameraUrl;
try{
cameraUrl = new URL(streamUrl);
if(!["http:", "https:"].includes(cameraUrl.protocol)) throw new Error("Unsupported camera URL");
}catch(error){
cameraStatus.innerText = "Enter a valid http:// camera stream URL";
return;
}

if(cameraRefreshTimer !== null){
window.clearInterval(cameraRefreshTimer);
cameraRefreshTimer = null;
}

const isSnapshotEndpoint = cameraUrl.pathname.replace(/\/+$/, "") === "/capture";
cameraUrlInput.value = cameraUrl.href;
cameraStatus.innerText = "Connecting to camera...";
cameraPlaceholder.hidden = true;
cameraFeed.hidden = false;
cameraFeed.onload = () => {
cameraStatus.innerText = isSnapshotEndpoint ? "Live snapshot feed connected" : "Live camera connected";
if(isSnapshotEndpoint && cameraRefreshTimer === null){
cameraRefreshTimer = window.setInterval(loadNextSnapshot, 750);
}
};
cameraFeed.onerror = () => {
if(cameraRefreshTimer !== null){
window.clearInterval(cameraRefreshTimer);
cameraRefreshTimer = null;
}
cameraFeed.hidden = true;
cameraPlaceholder.hidden = false;
cameraStatus.innerText = "Camera unavailable; check its IP and Wi-Fi";
};

function loadNextSnapshot(){
const nextFrameUrl = new URL(cameraUrl.href);
nextFrameUrl.searchParams.set("_frame", String(Date.now()));
cameraFeed.src = nextFrameUrl.href;
}

if(isSnapshotEndpoint){
loadNextSnapshot();
}else{
cameraFeed.src = cameraUrl.href;
}

try{
localStorage.setItem(cameraStorageKey, cameraUrl.href);
}catch(error){
}
}

function stopCamera(){
if(cameraRefreshTimer !== null){
window.clearInterval(cameraRefreshTimer);
cameraRefreshTimer = null;
}
cameraFeed.onload = null;
cameraFeed.onerror = null;
cameraFeed.removeAttribute("src");
cameraFeed.hidden = true;
cameraPlaceholder.hidden = false;
cameraStatus.innerText = "Camera feed stopped";
try{
localStorage.removeItem(cameraStorageKey);
}catch(error){
}
}

cameraForm.addEventListener("submit", event => {
event.preventDefault();
connectCamera(cameraUrlInput.value.trim());
});
document.getElementById("stopCameraButton").addEventListener("click", stopCamera);

// Bind controls and restore saved lane and camera settings.
menuToggle.addEventListener("click", () => {
const isOpening = menuPanel.hidden;
menuPanel.hidden = !isOpening;
menuToggle.setAttribute("aria-expanded", String(isOpening));
});

connectButton.addEventListener("click", () => {
closeMenu();
connect();
});
disconnectButton.addEventListener("click", () => {
closeMenu();
disconnect();
});
document.getElementById("raceSetupButton").addEventListener("click", openRaceSetup);
raceSetupForm.addEventListener("submit", saveRaceSetup);
cancelSetupButton.addEventListener("click", closeRaceSetup);
connectBeforeStartButton.addEventListener("click", () => {
setupConnectionStatus.innerText = "Choose the ESP32 serial port...";
connectBeforeStartButton.disabled = true;
connect();
});
document.getElementById("editSetupButton").addEventListener("click", returnToRaceSetup);
document.getElementById("viewDashboardOfflineButton").addEventListener("click", viewDashboardWithoutESP32);
retryStartButton.addEventListener("click", retryAfterFalseStart);
document.getElementById("returnToDashboardButton").addEventListener("click", returnFromFinishScreen);
document.querySelector(".leaderboard").addEventListener("change", event => {
if(event.target.matches(".lane-number, .lane-driver")) saveLaneInputs();
});
weatherButton.addEventListener("click", () => {
if(weatherLocation){
refreshWeather();
}else{
requestWeatherLocation();
}
});

restoreLaneInputs();
restoreRaceSetup();
loadSoundCloudWidget();
ensureLaneRows();
applyLaneCount();
updateSpeedMetrics();
updateLapsToGo();
try{
const savedCameraUrl = localStorage.getItem(cameraStorageKey);
if(savedCameraUrl){
cameraUrlInput.value = savedCameraUrl;
connectCamera(savedCameraUrl);
}
}catch(error){
}
