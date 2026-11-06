HTR/
│
├── 3dModels/                                   # 3D-modellen en CAD-bestanden (.stl)
│   ├── chassis/
│   │   ├── Bottom_part_chassis.stl
│   │   └── V.1 chassis/
│   │       └── Bottom_part.stl
│   │
│   ├── differential gear/
│   │   ├── changed parts/
│   │   │   └── enlonged_pinX2.stl
│   │   └── V.1 differential gear/
│   │       ├── 2x_bearing_shell_outside.stl
│   │       ├── 2x_gear_inside.stl
│   │       ├── 2x_gear_output.stl
│   │       ├── 2x_gearbox_pin_outside.stl
│   │       ├── 2x_pin.stl
│   │       ├── 2x_sleeve.stl
│   │       ├── assembly_pdf
│   │       ├── bottom_part.stl
│   │       ├── cover.stl
│   │       ├── gear.stl
│   │       ├── gearbox_left.stl
│   │       ├── gearbox_pin_inside.stl
│   │       ├── gearbox_right.stl
│   │       ├── optional_2x_rim.stl
│   │       └── top_motor_bracket.stl
│   │
│   └── steering shaft/
│       └── V.1 steering shaft/
│           └── steering shaft.stl
│
├── Documentatie algemeen/
│   └── DTRdocNL.pdf                            # Algemene documentatie / technisch rapport
│
├── Electronic part list/
│   └── partList.xlsx                           # Stuklijst met elektronische componenten
│
└── FInish line documenten/                     # Finishlijn hardware, dashboard en firmware
    ├── Testraport race dashboard.docx          # Testrapportage van het dashboard
    └── Code/
        ├── README.txt                          # Instructies/toelichting m.b.t. code
        └── racetimer wout test2/
            ├── desktop.ini
            ├── index.html                      # Webinterface voor het racedashboard
            ├── style.css                       # Styling van het dashboard
            ├── script.js                       # Frontend logica en WebSockets
            ├── woutracetimer.ino               # ESP32 firmware voor de tijdmeting (lichtsluis)
            └── xiao_camera_stream.ino          # Firmware voor de camera-module (ESP32-CAM)