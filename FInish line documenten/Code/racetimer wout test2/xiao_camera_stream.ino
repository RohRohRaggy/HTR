// XIAO ESP32S3 Sense multipart MJPEG server.
// The dashboard reads the continuous stream from /stream.
#include <WiFi.h>
#include <esp_camera.h>
#include <esp_http_server.h>
#include <esp_arduino_version.h>

const char *wifiSsid = "YOUR_WIFI_NAME";
const char *wifiPassword = "YOUR_WIFI_PASSWORD";

// Camera GPIO map for the XIAO ESP32S3 Sense expansion board.
#define CAMERA_PIN_PWDN -1
#define CAMERA_PIN_RESET -1
#define CAMERA_PIN_XCLK 10
#define CAMERA_PIN_SIOD 40
#define CAMERA_PIN_SIOC 39
#define CAMERA_PIN_Y9 48
#define CAMERA_PIN_Y8 11
#define CAMERA_PIN_Y7 12
#define CAMERA_PIN_Y6 14
#define CAMERA_PIN_Y5 16
#define CAMERA_PIN_Y4 18
#define CAMERA_PIN_Y3 17
#define CAMERA_PIN_Y2 15
#define CAMERA_PIN_VSYNC 38
#define CAMERA_PIN_HREF 47
#define CAMERA_PIN_PCLK 13

static httpd_handle_t cameraServer = nullptr;

// Send JPEG frames continuously while the browser keeps /stream open.
static esp_err_t streamHandler(httpd_req_t *request) {
httpd_resp_set_type(request, "multipart/x-mixed-replace; boundary=frame");
httpd_resp_set_hdr(request, "Access-Control-Allow-Origin", "*");
httpd_resp_set_hdr(request, "Cache-Control", "no-store");

while (true) {
camera_fb_t *frame = esp_camera_fb_get();
if (!frame) {
delay(100);
continue;
}

char header[128];
size_t headerLength = snprintf(header, sizeof(header),
"\r\n--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
static_cast<unsigned int>(frame->len));

esp_err_t result = httpd_resp_send_chunk(request, header, headerLength);
if (result == ESP_OK) {
result = httpd_resp_send_chunk(request,
reinterpret_cast<const char *>(frame->buf), frame->len);
}

esp_camera_fb_return(frame);
if (result != ESP_OK) break;
}

return ESP_OK;
}

// Start the HTTP server on port 80 and register the /stream endpoint.
bool startCameraServer() {
httpd_config_t config = HTTPD_DEFAULT_CONFIG();
config.server_port = 80;
if (httpd_start(&cameraServer, &config) != ESP_OK) {
Serial.println("CAMERA:HTTP_START_FAILED");
return false;
}

httpd_uri_t streamUri = {};
streamUri.uri = "/stream";
streamUri.method = HTTP_GET;
streamUri.handler = streamHandler;
streamUri.user_ctx = nullptr;

if (httpd_register_uri_handler(cameraServer, &streamUri) != ESP_OK) {
Serial.println("CAMERA:STREAM_ROUTE_FAILED");
httpd_stop(cameraServer);
cameraServer = nullptr;
return false;
}

return true;
}

// Use VGA when PSRAM is available for a sharper image; fall back to QVGA otherwise.
void setupCamera() {
const bool hasPsram = psramFound();
const framesize_t frameSize = hasPsram ? FRAMESIZE_VGA : FRAMESIZE_QVGA;
const int jpegQuality = hasPsram ? 10 : 14;

camera_config_t config = {};
config.ledc_channel = LEDC_CHANNEL_0;
config.ledc_timer = LEDC_TIMER_0;
config.pin_d0 = CAMERA_PIN_Y2;
config.pin_d1 = CAMERA_PIN_Y3;
config.pin_d2 = CAMERA_PIN_Y4;
config.pin_d3 = CAMERA_PIN_Y5;
config.pin_d4 = CAMERA_PIN_Y6;
config.pin_d5 = CAMERA_PIN_Y7;
config.pin_d6 = CAMERA_PIN_Y8;
config.pin_d7 = CAMERA_PIN_Y9;
config.pin_xclk = CAMERA_PIN_XCLK;
config.pin_pclk = CAMERA_PIN_PCLK;
config.pin_vsync = CAMERA_PIN_VSYNC;
config.pin_href = CAMERA_PIN_HREF;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
config.pin_sccb_sda = CAMERA_PIN_SIOD;
config.pin_sccb_scl = CAMERA_PIN_SIOC;
#else
config.pin_sscb_sda = CAMERA_PIN_SIOD;
config.pin_sscb_scl = CAMERA_PIN_SIOC;
#endif
config.pin_pwdn = CAMERA_PIN_PWDN;
config.pin_reset = CAMERA_PIN_RESET;
config.xclk_freq_hz = 20000000;
config.pixel_format = PIXFORMAT_JPEG;
config.frame_size = frameSize;
config.jpeg_quality = jpegQuality;
config.fb_count = hasPsram ? 2 : 1;
config.grab_mode = hasPsram ? CAMERA_GRAB_LATEST : CAMERA_GRAB_WHEN_EMPTY;
config.fb_location = hasPsram ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;

esp_err_t result = esp_camera_init(&config);
if (result != ESP_OK) {
Serial.printf("CAMERA:INIT_FAILED:0x%x\n", result);
while (true) delay(1000);
}

sensor_t *sensor = esp_camera_sensor_get();
if (sensor) {
sensor->set_framesize(sensor, frameSize);
sensor->set_quality(sensor, jpegQuality);
sensor->set_brightness(sensor, -1);
sensor->set_contrast(sensor, -2);
sensor->set_saturation(sensor, -2);
}
}

// Connect to Wi-Fi and print the stream URL for the dashboard.
void setup() {
Serial.begin(115200);
delay(300);
Serial.println("CAMERA:BOOT");

setupCamera();

WiFi.mode(WIFI_STA);
WiFi.setSleep(false);
WiFi.begin(wifiSsid, wifiPassword);
Serial.print("WIFI:CONNECTING");

unsigned long connectStartedAt = millis();
while (WiFi.status() != WL_CONNECTED) {
delay(500);
Serial.print(".");
if (millis() - connectStartedAt >= 30000) {
Serial.println("\nWIFI:FAILED_CHECK_CREDENTIALS");
while (true) delay(1000);
}
}

Serial.println("\nWIFI:CONNECTED");
if (!startCameraServer()) {
while (true) delay(1000);
}

	Serial.print("STREAM_URL:http://");
Serial.print(WiFi.localIP());
	Serial.println("/stream");
}

// Reconnect Wi-Fi if needed while the HTTP camera server runs.
void loop() {
if (WiFi.status() != WL_CONNECTED) {
WiFi.reconnect();
delay(1000);
}
delay(100);
}
