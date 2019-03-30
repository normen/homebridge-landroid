# homebridge-landroid [![NPM Version](https://img.shields.io/npm/v/homebridge-landroid.svg)](https://www.npmjs.com/package/homebridge-landroid)
Homebridge plugin to control Worx Landroid robo mowers through the Worx Cloud

### Features
 - Start mower
 - Return mower to home
 - Mowing status (on / off)
 - Error status
 - Battery Status (Ask Siri, the Home app doesn't show battery for switches)

## Example config
```
{
  "bridge": {
    "name": "Homebridge",
    "username": "CC:22:3D:E3:CE:30",
    "port": 51826,
    "pin": "031-45-154"
  },
  "platforms": [
    {
      "platform": "Landroid",
      "landroids": [
        {
          "name": "My Landroid",
          "email": "my@email.com",
          "pwd": "my_password",
          "dev_sel": 0
        }
      ]
    }
  ]
}
```

### Options:
 - `name` Name for your Landroid to appear in HomeKit
 - `email` eMail for your Worx account
 - `pwd` password for your Worx account
 - `dev_sel` device number if you have more than one Landroid, default `0`
