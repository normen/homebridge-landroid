"use strict";

/*
 * Created with @homebridge/create-adapter v2.3.0
 */

const Adapter = require("./CloudAdapter");
const axios = require("axios").default;
//const awsIot = require("aws-iot-device-sdk").device;
const { mqtt, iot } = require("aws-iot-device-sdk-v2");
// const qs = require("qs");
const Json2iob = require("json2iob");
const tough = require("tough-cookie");
const { HttpsCookieAgent } = require("http-cookie-agent/http");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const objects = require(`./lib/objects`);
const helper = require(`./lib/helper`);
const not_allowed = 60000 * 10;
const mqtt_poll_max = 60000;
const poll_check = 1000; //1 sec.
const ping_interval = 1000 * 60 * 10; //10 Minutes
const max_request = 20;
const category = "homebridge";

class Worx extends Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "worx",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.deviceArray = [];
        this.fw_available = {};
        this.laststatus = {};
        this.lasterror = {};
        this.week = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        this.userAgent = "HomeBridge ";
        this.reLoginTimeout = null;
        this.refreshActivity = null;
        this.loadActivity = {};
        this.refreshTokenTimeout = null;
        this.pingInterval = {};
        this.mqtt_blocking = 0;
        this.mqtt_restart = null;
        this.vision = {};
        this.poll_check_time = 0;
        this.requestCounter = 0;
        this.reconnectCounter = 0;
        this.requestCounterStart = Date.now();
        this.session = {};
        this.initConnection = true;
        this.mqttC = null;
        this.mqtt_response_check = {};
        this.createDevices = helper.createDevices;
        this.createActivity = helper.createActivity;
        this.setStates = helper.setStates;
        this.cleanupRaw = helper.cleanupRaw;
        this.createDataPoint = helper.createDataPoint;
        this.createMqttData = helper.createMqttData;
        this.json2iob = new Json2iob(this);
        this.cookieJar = new tough.CookieJar();
        this.requestClient = axios.create({
            withCredentials: true,
            httpsAgent: new HttpsCookieAgent({
                cookies: {
                    jar: this.cookieJar,
                },
            }),
        });
        this.modules = {};
        this.clouds = {
            worx: {
                url: "api.worxlandroid.com",
                loginUrl: "https://id.worx.com/",
                clientId: "150da4d2-bb44-433b-9429-3773adc70a2a",
                redirectUri: "com.worxlandroid.landroid://oauth-callback/",
                mqttPrefix: "WX",
            },
            kress: {
                url: "api.kress-robotik.com",
                loginUrl: "https://id.kress.com/",
                clientId: "931d4bc4-3192-405a-be78-98e43486dc59",
                redirectUri: "com.kress-robotik.mission://oauth-callback/",
                mqttPrefix: "KR",
            },
            landxcape: {
                url: "api.landxcape-services.com",
                loginUrl: "https://id.landxcape-services.com/",
                clientId: "dec998a9-066f-433b-987a-f5fc54d3af7c",
                redirectUri: "com.landxcape-robotics.landxcape://oauth-callback/",
                mqttPrefix: "LX",
            },
            ferrex: {
                url: "api.watermelon.smartmower.cloud",
                loginUrl: "https://id.watermelon.smartmower.cloud/",
                clientId: "10078D10-3840-474A-848A-5EED949AB0FC",
                redirectUri: "cloud.smartmower.watermelon://oauth-callback/",
                mqttPrefix: "FE",
            },
        };
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        this.userAgent += this.version;

        if (!this.config.mail || !this.config.password) {
            this.log.error("Please set username and password in the instance settings");
            return;
        }
        // eslint-disable-next-line no-control-regex
        if (/[\x00-\x08\x0E-\x1F\x80-\xFF]/.test(this.config.password)) {
            this.log.error("Password is now encrypted: Please re-enter the password in the instance settings");
            return;
        }

        this.subscribeStates("*");

        this.log.info("Login to " + this.config.server);
        await this.login();
        if (this.session.access_token) {
            await this.getDeviceList();
            await this.updateDevices();
            await this.createMqttData();
            this.log.info("Start MQTT connection");
            await this.start_mqtt();

            this.updateFW = this.setInterval(
                async () => {
                    await this.updateFirmware();
                },
                24 * 60 * 1000 * 60,
            ); // 24 hour

            this.updateInterval = this.setInterval(
                async () => {
                    await this.updateDevices();
                },
                10 * 60 * 1000,
            ); // 10 minutes

            if (!this.session.expires_in || this.session.expires_in < 200) {
                this.session.expires_in = 3600;
            }
            this.updateMqttData(true);
            this.refreshTokenInterval = this.setInterval(
                () => {
                    this.refreshToken();
                },
                (this.session.expires_in - 200) * 1000,
            );

            this.refreshActivity = this.setInterval(() => {
                this.createActivityLogStates();
            }, 60 * 1000); // 1 minutes
        }
    }
    async login() {
        //Simple login
        const data = await this.requestClient({
            url: this.clouds[this.config.server].loginUrl + "oauth/token",
            method: "post",
            headers: {
                accept: "application/json",
                "content-type": "application/json",
                "user-agent": this.userAgent,
                "accept-language": "de-de",
            },
            data: JSON.stringify({
                client_id: this.clouds[this.config.server].clientId,
                username: this.config.mail,
                password: this.config.password,
                scope: "*",
                grant_type: "password",
            }),
        })
            .then((response) => {
                this.log.debug(JSON.stringify(response.data));
                this.session = response.data;
                this.setState("info.connection", true, true);
                this.log.info(`Connected to ${this.config.server} server`);
            })
            .catch((error) => {
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
        return data;

        /* App login simulation
        const [code_verifier, codeChallenge] = this.getCodeChallenge();
        const loginForm = await this.requestClient({
            method: "get",
            url:
                this.clouds[this.config.server].loginUrl +
                "oauth/authorize?response_type=code&client_id=" +
                this.clouds[this.config.server].clientId +
                "&redirect_uri=" +
                this.clouds[this.config.server].redirectUri +
                "&scope=user:manage%20data:products%20mower:pair%20mower:update%20mower:lawn%20mower:view%20user:certificate%20user:profile%20mower:unpair%20mobile:notifications%20mower:warranty%20mower:firmware%20mower:activity_log&state=-u8vt3mPPBuugVgUpr4CD53MkzsyTeKP-x528sQ8&code_challenge=" +
                codeChallenge +
                "&code_challenge_method=S256&suggested_authentication_flow=login",
            headers: {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*\/*;q=0.8",
                "user-agent": this.userAgent,
                "accept-language": "de-de",
            },
        })
            .then((response) => {
                this.log.info("Login form loaded");
                return response.data;
            })
            .catch((error) => {
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
        const form = this.extractHidden(loginForm);
        form.email = this.config.mail;
        form.password = this.config.password;
        const codeResponse = await this.requestClient({
            method: "post",
            url: this.clouds[this.config.server].loginUrl + "login",
            headers: {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*\/*;q=0.8",
                "content-type": "application/x-www-form-urlencoded",
                "accept-language": "de-de",
                "user-agent": this.userAgent,
            },
            data: qs.stringify(form),
        })
            .then((response) => {
                this.log.error("Login form submission failed");
                const errorText = response.data.match('help is-danger">(.*)<');
                errorText && this.log.error(errorText[1]);
                return;
            })
            .catch((error) => {
                if (error && error.message.includes("Unsupported protocol")) {
                    this.log.info("Received Code");
                    return qs.parse(error.request._options.path.split("?")[1]);
                }
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
        if (!codeResponse) {
            this.log.warn("Could not get code response");
            return;
        }

        const data = await this.requestClient({
            url: this.clouds[this.config.server].loginUrl + "oauth/token?",
            method: "post",
            headers: {
                accept: "application/json",
                "content-type": "application/json",
                "user-agent": this.userAgent,
                "accept-language": "de-de",
            },
            data: JSON.stringify({
                client_id: this.clouds[this.config.server].clientId,
                code: codeResponse.code,
                redirect_uri: this.clouds[this.config.server].redirectUri,
                code_verifier: code_verifier,
                grant_type: "authorization_code",
            }),
        })
            .then((response) => {
                this.log.debug(JSON.stringify(response.data));
                this.session = response.data;
                this.setState("info.connection", true, true);
                this.log.info(`Connected to ${this.config.server} server`);
            })
            .catch((error) => {
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
        return data;
        */
    }

    async getDeviceList() {
        await this.requestClient({
            method: "get",
            url: `https://${this.clouds[this.config.server].url}/api/v2/product-items?status=1&gps_status=1`,
            headers: {
                accept: "application/json",
                "content-type": "application/json",
                "user-agent": this.userAgent,
                authorization: "Bearer " + this.session.access_token,
                "accept-language": "de-de",
            },
        })
            .then(async (res) => {
                this.log.debug(JSON.stringify(res.data));
                this.log.info(`Found ${res.data.length} devices`);
                for (const device of res.data) {
                    const id = device.serial_number;
                    this.vision[device.uuid] = device.serial_number;
                    this.modules[device.serial_number] = {};
                    this.modules[device.serial_number]["edgeCut"] = false;
                    const name = device.name;
                    this.fw_available[device.serial_number] = false;
                    this.log.info(`Found device ${name} with id ${id}`);

                    await this.cleanOldVersion(id);
                    await this.createDevices(device);
                    const fw_id = await this.apiRequest(`product-items/${id}/firmware-upgrade`, false);
                    this.log.debug("fw_id: " + JSON.stringify(fw_id));
                    await this.createAdditionalDeviceStates(device, fw_id);
                    this.deviceArray.push(device);
                    if (
                        device &&
                        device.last_status &&
                        device.last_status.payload &&
                        device.last_status.payload.dat &&
                        device.last_status.payload.dat.ls != null &&
                        device.last_status.payload.dat.le != null
                    ) {
                        this.laststatus[id] = device.last_status.payload.dat.ls;
                        this.lasterror[id] = device.last_status.payload.dat.le;
                        this.loadActivity[id] = false;
                    }
                    await this.createActivityLogStates(device, true);
                    await this.createProductStates(device);
                    // this.json2iob.parse(`${id}.rawMqtt`, await this.cleanupRaw(device), {
                    //     forceIndex: true,
                    // });
                }
            })
            .catch((error) => {
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
    }

    async createProductStates(mower) {
        if (mower && mower.serial_number) {
            const products = await this.apiRequest("products", true);
            this.log.debug(JSON.stringify(products));
            const productID = mower && mower.product_id ? mower.product_id : 0;
            if (products && products[0] && products[0].id) {
                for (const sl of products) {
                    if (sl && sl.id && sl.id === productID) {
                        this.log.info(`Create product folder and states for ${sl.code}`);
                        this.json2iob.parse(`${mower.serial_number}.product`, sl, {
                            write: false,
                            forceIndex: true,
                            channelName: "Mower product and board Info",
                            autoCast: true,
                        });
                        break;
                    }
                }
            }
        }
    }
    async createActivityLogStates(mower, firstStart) {
        if (mower && mower.serial_number) {
            //first start while get devices
            const activity_log = await this.apiRequest(`product-items/${mower.serial_number}/activity-log`, false);
            if (activity_log && Object.keys(activity_log).length > 0 && activity_log[0] && activity_log[0]._id) {
                if (firstStart) {
                    this.log.info("Create folder activityLog and set states.");
                    await this.createActivity(mower);
                }
                await this.setStateAsync(`${mower.serial_number}.activityLog.payload`, {
                    val: JSON.stringify(activity_log),
                    ack: true,
                });
                await this.setStateAsync(`${mower.serial_number}.activityLog.last_update`, {
                    val: Date.now(),
                    ack: true,
                });
            }
            return;
        }
        for (const device of this.deviceArray) {
            //check if setState set loadActivity on true because of changed lasterror or laststatus
            if (
                device &&
                device.serial_number &&
                this.loadActivity[device.serial_number] != null &&
                this.loadActivity[device.serial_number]
            ) {
                this.log.debug("START UPDATE CHANGE");
                await this.sleep(10000); //Wait 10s because it takes some time for the last log item available at the API endpoint
                const activity_log = await this.apiRequest(`product-items/${device.serial_number}/activity-log`, false);
                if (activity_log && Object.keys(activity_log).length > 0 && activity_log[0] && activity_log[0]._id) {
                    this.log.debug("UPDATE CHANGE");
                    await this.setStateAsync(`${device.serial_number}.activityLog.payload`, {
                        val: JSON.stringify(activity_log),
                        ack: true,
                    });
                    await this.setStateAsync(`${device.serial_number}.activityLog.last_update`, {
                        val: Date.now(),
                        ack: true,
                    });
                }
                this.loadActivity[device.serial_number] = false;
            } else {
                this.loadActivity[device.serial_number] = false;
            }
        }
    }

    async updateFirmware() {
        for (const mower of this.deviceArray) {
            if (this.fw_available[mower.serial_number] === true) {
                const fw_json = await this.apiRequest(`product-items/${mower.serial_number}/firmware-upgrade`, false);
                let version = 0;
                let released_at = "";
                let json;
                if (Object.keys(fw_json).length > 0 && fw_json.product && fw_json.product.version) {
                    version = parseFloat(fw_json.product.version);
                    released_at = fw_json.product.released_at;
                    json = JSON.stringify(fw_json);
                } else {
                    const is_set = await this.getStateAsync(`${mower.serial_number}.mower.firmware_available`);
                    if (is_set && is_set.val != null && typeof is_set.val === "number" && is_set.val > 0) {
                        this.log.debug(`Update not needed!`);
                        return;
                    }
                    version = parseFloat(mower.firmware_version);
                    released_at = "1970-01-01";
                    json = JSON.stringify({
                        mandatory: false,
                        product: {
                            uuid: mower.uuid,
                            version: parseFloat(mower.firmware_version),
                            released_at: "1970-01-01",
                            changelog: "Update only when new firmware is available.",
                        },
                    });
                }
                await this.setStateAsync(`${mower.serial_number}.mower.firmware_available`, {
                    val: version,
                    ack: true,
                });
                await this.setStateAsync(`${mower.serial_number}.mower.firmware_available_date`, {
                    val: released_at,
                    ack: true,
                });
                await this.setStateAsync(`${mower.serial_number}.mower.firmware_available_all`, {
                    val: json,
                    ack: true,
                });
            }
        }
    }

    async updateDevices() {
        const statusArray = [
            {
                path: "rawMqtt",
                url: `https://${this.clouds[this.config.server].url}/api/v2/product-items/$id/?status=1&gps_status=1`,
                desc: "All raw data of the mower",
            },
        ];
        for (const device of this.deviceArray) {
            for (const element of statusArray) {
                const url = element.url.replace("$id", device.serial_number);
                await this.requestClient({
                    method: "get",
                    url: url,
                    headers: {
                        accept: "application/json",
                        "content-type": "application/json",
                        "user-agent": this.userAgent,
                        authorization: "Bearer " + this.session.access_token,
                        "accept-language": "de-de",
                    },
                })
                    .then(async (res) => {
                        this.log.debug(JSON.stringify(res.data));
                        if (!res.data) {
                            return;
                        }
                        const data = res.data;
                        const forceIndex = true;
                        const preferedArrayName = null;
                        await this.setStates(data);
                        const index = this.deviceArray.findIndex((index) => index.serial_number === data.serial_number);
                        this.log.debug(`Index Update: ${index}`);
                        if (index != null && this.deviceArray[index] != null) {
                            this.log.debug(`Update this.deviceArray: ${index}`);
                            this.deviceArray[index] = data;
                        }
                        try {
                            if (!data || !data.last_status || !data.last_status.payload) {
                                this.log.debug("No last_status found");
                                delete data.last_status;
                                this.log.debug("Delete last_status");
                            }
                        } catch (error) {
                            this.log.debug("Delete last_status: " + error);
                        }
                        const new_data = await this.cleanupRaw(data);
                        if (new_data.last_status && new_data.last_status.timestamp != null) {
                            delete new_data.last_status.timestamp;
                        }
                        this.json2iob.parse(`${device.serial_number}.${element.path}`, new_data, {
                            forceIndex: forceIndex,
                            preferedArrayName: preferedArrayName,
                            channelName: element.desc,
                        });

                        // await this.setObjectNotExistsAsync(element.path + ".json", {
                        //     type: "state",
                        //     common: {
                        //         name: "Raw JSON",
                        //         write: false,
                        //         read: true,
                        //         type: "string",
                        //         role: "json",
                        //     },
                        //     native: {},
                        // });
                        // this.setState(element.path + ".json", JSON.stringify(data), true);
                    })
                    .catch((error) => {
                        if (error.response) {
                            if (error.response.status === 401) {
                                error.response && this.log.debug(JSON.stringify(error.response.data));
                                this.log.info(element.path + " receive 401 error. Refresh Token in 60 seconds");
                                this.refreshTokenTimeout && this.clearTimeout(this.refreshTokenTimeout);
                                this.refreshTokenTimeout = this.setTimeout(() => {
                                    this.refreshToken();
                                }, 1000 * 60);
                                return;
                            }
                        }
                        this.log.error(element.url);
                        this.log.error(error);
                        error.response && this.log.error(JSON.stringify(error.response.data));
                    });
            }
        }
    }

    async refreshToken() {
        this.log.debug("Refresh token");
        await this.requestClient({
            url: this.clouds[this.config.server].loginUrl + "oauth/token?",
            method: "post",
            headers: {
                accept: "application/json",
                "content-type": "application/json",
                "user-agent": this.userAgent,
                "accept-language": "de-de",
            },
            data: JSON.stringify({
                client_id: this.clouds[this.config.server].clientId,
                scope: "user:profile mower:firmware mower:view mower:pair user:manage mower:update mower:activity_log user:certificate data:products mower:unpair mower:warranty mobile:notifications mower:lawn",
                refresh_token: this.session.refresh_token,
                grant_type: "refresh_token",
            }),
        })
            .then((response) => {
                this.log.debug(JSON.stringify(response.data));
                this.session = response.data;
                this.log.debug("Refresh token for MQTT-Connection");
                this.updateMqttData(false);
                this.start_mqtt();
            })
            .catch((error) => {
                this.log.error(error);
                error.response && this.log.error(JSON.stringify(error.response.data));
            });
    }

    async createAdditionalDeviceStates(mower, fw_json) {
        if (!mower || !mower.last_status || !mower.last_status.payload) {
            this.log.debug("No payload found");
            return;
        }
        const status = mower.last_status.payload;
        if (status && status.cfg && status.cfg.sc && status.cfg.sc.dd) {
            this.log.info("DoubleShedule found, create states...");

            // create States
            let week_count = 0;
            for (const day of this.week) {
                const common = {
                    name: objects.weekname2[week_count],
                };
                ++week_count;
                await this.createDataPoint(`${mower.serial_number}.calendar.${day}2`, common, "channel");
                for (const o of objects.calendar) {
                    await this.createDataPoint(
                        `${mower.serial_number}.calendar.${day}2.${o._id}`,
                        o.common,
                        o.type,
                        o.native,
                    );
                }
            }
        }

        if (
            (status && status.cfg && status.cfg.sc != null && status.cfg.sc.ots != null) ||
            (status &&
                status.cfg &&
                status.cfg.sc != null &&
                status.cfg.sc.once != null &&
                status.cfg.sc.once.time != null)
        ) {
            this.log.info("OneTimeShedule found, create states...");

            // create States
            for (const o of objects.oneTimeShedule) {
                await this.createDataPoint(`${mower.serial_number}.mower.${o._id}`, o.common, o.type, o.native);
            }
            await this.setStateAsync(`${mower.serial_number}.mower.firmware_update_start`, {
                val: false,
                ack: true,
            });
            await this.setStateAsync(`${mower.serial_number}.mower.firmware_update_start_approved`, {
                val: false,
                ack: true,
            });
        }

        if (fw_json) {
            this.fw_available[mower.serial_number] = true;
            this.log.info("Firmware found, create states...");
            for (const o of objects.firmware_available) {
                await this.createDataPoint(`${mower.serial_number}.mower.${o._id}`, o.common, o.type, o.native);
            }
            let version = 0;
            let released_at = "";
            let json;
            if (Object.keys(fw_json).length > 0 && fw_json.product && fw_json.product.version) {
                version = parseFloat(fw_json.product.version);
                released_at = fw_json.product.version;
                json = JSON.stringify(fw_json);
            } else {
                const is_set = await this.getStateAsync(`${mower.serial_number}.mower.firmware_available`);
                if (is_set && is_set.val != null && typeof is_set.val === "number" && is_set.val > 0) {
                    this.log.debug(`Update not needed!`);
                    return;
                }
                version = parseFloat(mower.firmware_version);
                released_at = "1970-01-01";
                json = JSON.stringify({
                    mandatory: false,
                    product: {
                        uuid: mower.uuid,
                        version: parseFloat(mower.firmware_version),
                        released_at: "1970-01-01",
                        changelog: "Update only when new firmware is available.",
                    },
                });
            }
            await this.setStateAsync(`${mower.serial_number}.mower.firmware_available`, {
                val: version,
                ack: true,
            });
            await this.setStateAsync(`${mower.serial_number}.mower.firmware_available_date`, {
                val: released_at,
                ack: true,
            });
            await this.setStateAsync(`${mower.serial_number}.mower.firmware_available_all`, {
                val: json,
                ack: true,
            });
        }

        if (status && status.cfg && status.cfg.sc && status.cfg.sc.distm != null && status.cfg.sc.m != null) {
            this.log.info("PartyModus found, create states...");
            // create States
            for (const o of objects.partyModus) {
                await this.createDataPoint(`${mower.serial_number}.mower.${o._id}`, o.common, o.type, o.native);
            }
        }
        // Vision PartyMode
        if (status && status.cfg && status.cfg.sc && status.cfg.sc.enabled != null) {
            this.log.info("PartyModus found, create states...");
            // create States
            for (const o of objects.partyModus) {
                await this.createDataPoint(`${mower.serial_number}.mower.${o._id}`, o.common, o.type, o.native);
            }
        }
        // Vision Paused
        if (status && status.cfg && status.cfg.sc && status.cfg.sc.paused != null) {
            this.log.info("Paused found, create states...");
            // create States
            for (const o of objects.paused) {
                await this.createDataPoint(`${mower.serial_number}.mower.${o._id}`, o.common, o.type, o.native);
            }
        }
        if (mower.capabilities != null && !mower.capabilities.includes("vision")) {
            await this.createDataPoint(
                `${mower.serial_number}.calendar.${objects.calJson[0]._id}`,
                objects.calJson[0].common,
                objects.calJson[0].type,
                objects.calJson[0].native,
            );
        }

        await this.createDataPoint(
            `${mower.serial_number}.calendar.${objects.calJson[1]._id}`,
            objects.calJson[1].common,
            objects.calJson[1].type,
            objects.calJson[1].native,
        );
        await this.createDataPoint(
            `${mower.serial_number}.calendar.${objects.calJson[2]._id}`,
            objects.calJson[2].common,
            objects.calJson[2].type,
            objects.calJson[2].native,
        );
        if (status && status.cfg && status.cfg.sc && status.cfg.sc.dd) {
            await this.createDataPoint(
                `${mower.serial_number}.calendar.${objects.calJson[0]._id}2`,
                objects.calJson[0].common,
                objects.calJson[0].type,
                objects.calJson[0].native,
            );
        }

        this.log.debug(JSON.stringify(mower));
    }

    async apiRequest(path, withoutToken, method, data) {
        const headers = {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": this.userAgent,
            "accept-language": "de-de",
        };
        if (!withoutToken) {
            headers["authorization"] = "Bearer " + this.session.access_token;
        }
        return await this.requestClient({
            method: method || "get",
            url: `https://${this.clouds[this.config.server].url}/api/v2/${path}`,
            headers: headers,
            data: data || null,
        })
            .then(async (res) => {
                this.log.debug(path);
                this.log.debug(JSON.stringify(res.data));
                if (method === "PUT") {
                    this.log.info(JSON.stringify(res.data));
                }
                return res.data;
            })
            .catch((error) => {
                if (path.includes("firmware-upgrade") && error.response.status === 404) {
                    this.log.debug("Updating firmware information is currently not possible!");
                    return error.response.status;
                } else {
                    this.log.error(error);
                    error.response && this.log.error(JSON.stringify(error.response.data));
                }
                if (error.response) {
                    if (error.response.status === 401) {
                        error.response && this.log.debug(JSON.stringify(error.response.data));
                        this.log.info(path + " receive 401 error. Refresh Token in 30 seconds");
                        this.refreshTokenTimeout && this.clearTimeout(this.refreshTokenTimeout);
                        this.refreshTokenTimeout = this.setTimeout(() => {
                            this.refreshToken();
                        }, 1000 * 30);
                        return;
                    }
                }
            });
    }

    async start_mqtt() {
        if (this.deviceArray.length === 0) {
            this.log.warn("No mower found to start mqtt");
            return;
        }

        if (!this.userData) {
            this.userData = await this.apiRequest("users/me", false);
        }

        try {
            this.connectMqtt();
        } catch (e) {
            this.log.info(`connectMqtt: ${e}`);
        }
    }

    async awsMqtt() {
        try {
            this.mqttC && (await this.mqttC.disconnect());
            const uuid = this.randomClientid(8, 64) || uuidv4();
            const accessTokenParts = this.session.access_token.replace(/_/g, "/").replace(/-/g, "+").split(".");
            this.userData.mqtt_newendpoint = this.deviceArray[0].mqtt_endpoint || "iot.eu-west-1.worxlandroid.com";
            if (this.deviceArray[0].mqtt_endpoint == null) {
                this.log.warn(`Cannot read mqtt_endpoint use default`);
            }
            let config_builder;
            try {
                config_builder = iot.AwsIotMqttConnectionConfigBuilder.new_default_builder();
            } catch (e) {
                this.log.warn(`error builder: ${e}`);
                return null;
            }
            config_builder.with_clean_session(false);
            config_builder.with_client_id(
                `${this.clouds[this.config.server].mqttPrefix}/USER/${this.userData.id}/${category}/${uuid}`,
            );
            config_builder.with_endpoint(this.userData.mqtt_newendpoint);
            //config_builder.with_port(443);
            //config_builder.with_reconnect_max_sec(1000);
            //config_builder.with_reconnect_min_sec(10000);
            //config_builder.with_keep_alive_seconds(30);
            config_builder.with_custom_authorizer(
                `${category}?jwt=${encodeURIComponent(accessTokenParts[0])}.${encodeURIComponent(accessTokenParts[1])}`,
                "",
                encodeURIComponent(accessTokenParts[2]),
                "",
                category,
                category,
            ); // Port is default 443
            let config;
            try {
                config = config_builder.build();
            } catch (e) {
                this.log.warn(`error build: ${e}`);
                return null;
            }
            const client = new mqtt.MqttClient();
            try {
                return client.new_connection(config);
            } catch (e) {
                this.log.warn(`error connection: ${e}`);
                return null;
            }
        } catch (e) {
            this.log.info(`awsMqtt: ${e}`);
            return null;
        }
    }

    async connectMqtt() {
        try {
            this.mqttC = await this.awsMqtt();
            if (this.mqttC == null) {
                this.log.warn("Error mqtt connection!");
                return;
            }

            this.mqttC.on("message", async (topic, message, dup, qos, retain) => {
                let data;
                try {
                    const json = Buffer.from(message);
                    data = JSON.parse(json.toString("utf-8"));
                    this.log.debug(`Mower MQTT: ${JSON.stringify(data)}`);
                    this.log.debug(`topic: ${topic} - dup: ${dup} - qos: ${qos} - retain: ${retain}`);
                } catch (error) {
                    this.log.warn(`Cannot parse mqtt message ${message} for topic ${topic}`);
                    return;
                }
                this.updateMqttData(false);
                this.mqtt_blocking = 0;
                const mower = this.deviceArray.find((mower) => mower.mqtt_topics.command_out === topic);
                const merge = this.deviceArray.findIndex((merge) => merge.mqtt_topics.command_out === topic);
                if (mower) {
                    this.log.debug(
                        "Worxcloud MQTT get Message for mower " + mower.name + " (" + mower.serial_number + ")",
                    );
                    try {
                        if (!data.cfg.sn) {
                            data.cfg.sn = mower.serial_number;
                        }
                        if (this.mqtt_response_check[data.cfg.id]) {
                            this.log.debug(`Request ID ${data.cfg.id} has been passed to the mower`);
                            this.lastCommand(this.mqtt_response_check, "response", data.cfg.id);
                            delete this.mqtt_response_check[data.cfg.id];
                        } else if (data.cfg.id > 1) {
                            this.log.debug(`Response ID ${data.cfg.id} from mower`);
                            this.lastCommand(data, "other", "cfg");
                        }
                    } catch (error) {
                        this.log.debug(`this.mqttC.on: ${error}`);
                    }
                    try {
                        if (!mower || !mower.last_status || !mower.last_status.payload) {
                            this.log.debug("No last_status found");
                            mower.last_status = {};
                            this.log.debug("Reset last_status");
                        } else {
                            this.log.debug("Set new timestamp");
                            try {
                                if (merge) {
                                    this.deviceArray[merge].last_status.payload = data;
                                }
                            } catch (error) {
                                this.log.info("Update deviceArray: " + error);
                            }
                            mower.last_status.payload = data;
                            mower.last_status.timestamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
                                .toISOString()
                                .replace("T", " ")
                                .replace("Z", "");
                        }
                    } catch (error) {
                        this.log.info("Mqtt Delete last_status: " + error);
                    }
                    if (this.config.pingMqtt) {
                        this.pingToMqtt(mower);
                    }
                    await this.setStates(mower);
                    const new_mower = await this.cleanupRaw(mower);
                    this.json2iob.parse(`${mower.serial_number}.rawMqtt`, new_mower, {
                        forceIndex: true,
                        preferedArrayName: null,
                    });
                } else {
                    this.log.info(`Worxcloud MQTT could not find mower topic - ${topic} in mowers`);
                    this.log.info(`Mower List : ${JSON.stringify(this.deviceArray)}`);
                }
            });

            this.mqttC.on("connect", async (session_present) => {
                this.setMqttOnline(true);
                this.log.debug(`MQTT connection: ${session_present}`);
                this.log.debug("MQTT connected to: " + this.userData.mqtt_newendpoint);
                this.mqtt_blocking = 0;
                this.mqtt_restart && this.clearTimeout(this.mqtt_restart);
                for (const mower of this.deviceArray) {
                    if (!mower.mqtt_topics) {
                        this.log.warn("No mqtt topics found for mower " + mower.serial_number);
                        continue;
                    }
                    if (this.mqttC == null) {
                        this.log.info(`Connection interrupted!`);
                        return;
                    }
                    await this.mqttC.subscribe(mower.mqtt_topics.command_out, mqtt.QoS.AtLeastOnce);
                    this.log.debug(
                        `Mower Endpoint : ${mower.mqtt_endpoint} with user id ${mower.user_id} and mqtt registered ${mower.mqtt_registered} iot_registered ${mower.iot_registered} online ${mower.online} `,
                    );
                    if (this.initConnection || this.config.updateMqtt) {
                        this.sendPing(mower, false, "", "startPing");
                    }
                    if (this.config.pingMqtt) {
                        this.pingToMqtt(mower);
                    }
                }
                this.initConnection = false;
            });

            this.mqttC.on("interrupt", async (error) => {
                this.log.info(`Connection interrupted: ${error}`);
                this.setMqttOnline(false);
            });

            this.mqttC.on("resume", async (return_code, session_present) => {
                this.setMqttOnline(false);
                this.log.info(`Resumed: rc: ${return_code} existing session: ${session_present}`);
                this.log.info("MQTT reconnect: " + this.mqtt_blocking);
                this.log.info(`Reconnect since adapter start: ${this.reconnectCounter}`);
                ++this.reconnectCounter;
                ++this.mqtt_blocking;
                if (this.mqtt_blocking > 15) {
                    this.log.warn(
                        "No Connection to Worx for 1 minute. Please check your internet connection or check in your App if Worx blocked you for 24h. Mqtt connection will restart automatic in 1h",
                    );
                    this.log.info(`Request counter since adapter start: ${this.requestCounter}`);
                    this.log.info(`Reconnects since adapter start: ${this.reconnectCounter}`);
                    this.log.info(`Adapter start date: ${new Date(this.requestCounterStart).toLocaleString()}`);

                    this.mqttC && (await this.mqttC.disconnect());
                    this.mqttC = null;
                    this.mqtt_restart && this.clearTimeout(this.mqtt_restart);
                    this.mqtt_restart = null;
                    this.mqtt_restart = this.setTimeout(
                        async () => {
                            this.log.info("Restart Mqtt after 1h");
                            this.start_mqtt();
                        },
                        1 * 60 * 1000 * 60,
                    ); // 1 hour
                }
            });

            this.mqttC.on("disconnect", () => {
                this.log.debug("Disconnected");
                this.setMqttOnline(false);
            });

            this.mqttC.on("error", (error) => {
                this.log.info(`MQTT ERROR: ${error}`);
                this.setMqttOnline(false);
            });
            await this.mqttC.connect();
        } catch (e) {
            this.log.info(`connectMqtt: ${e}`);
            this.setMqttOnline(false);
        }
    }

    setMqttOnline(state) {
        this.setState(`info_mqtt.online`, state, true);
    }

    updateMqttData(newToken) {
        if (this.mqttC != null && !newToken) {
            const statistic = this.mqttC.getQueueStatistics();
            if (statistic) {
                this.log.debug(`getQueueStatistics: ${JSON.stringify(statistic)}`);
                this.setState(`info_mqtt.incompleteOperationCount`, {
                    val: statistic.incompleteOperationCount != null ? statistic.incompleteOperationCount : 0,
                    ack: true,
                });
                this.setState(`info_mqtt.incompleteOperationSize`, {
                    val: statistic.incompleteOperationSize != null ? statistic.incompleteOperationSize : 0,
                    ack: true,
                });
                this.setState(`info_mqtt.unackedOperationCount`, {
                    val: statistic.unackedOperationCount != null ? statistic.unackedOperationCount : 0,
                    ack: true,
                });
                this.setState(`info_mqtt.unackedOperationSize`, {
                    val: statistic.unackedOperationSize != null ? statistic.unackedOperationSize : 0,
                    ack: true,
                });
            }
        }

        if (newToken) {
            const current_timestamp = Date.now();
            const next_timestamp = current_timestamp + (this.session.expires_in - 200) * 1000;
            this.setState(`info_mqtt.last_update`, {
                val: current_timestamp,
                ack: true,
            });
            this.setState(`info_mqtt.next_update`, {
                val: next_timestamp,
                ack: true,
            });
        }
    }

    /**
     * @param {object} mower
     */
    pingToMqtt(mower) {
        const mowerSN = mower.serial_number ? mower.serial_number : "";
        this.pingInterval[mowerSN] && this.clearInterval(this.pingInterval[mowerSN]);
        this.log.debug("Reset ping");
        this.pingInterval[mowerSN] = this.setInterval(() => {
            this.sendPing(mower, false, "", "pingToMqtt");
        }, ping_interval);
    }

    /**
     * @param {string} message JSON stringify example : '{"cmd":3}'
     */
    async sendMessage(message, serial, command) {
        this.log.debug("Worxcloud MQTT sendMessage to " + serial + " Message: " + message);

        if (serial == null) {
            this.log.error("please give a serial number!");
        }

        const mower = this.deviceArray.find((mower) => mower.serial_number === serial);

        if (mower) {
            if (this.mqttC) {
                this.requestCounter++;
                this.log.info(`Request Counter: ${this.requestCounter}`);
                try {
                    this.log.debug(`length:  ${Object.keys(this.mqtt_response_check).length}`);
                    if (Object.keys(this.mqtt_response_check).length > 50) {
                        this.cleanup_json();
                    }
                    const data = await this.sendPing(mower, true, JSON.parse(message));
                    message = JSON.stringify(data);
                    this.mqtt_response_check[data.id] = data;
                    await this.lastCommand(this.mqtt_response_check, "request", data.id, command);
                    this.log.debug(`this.mqtt_response_check:  ${JSON.stringify(this.mqtt_response_check)}`);
                    this.log.debug(`sendData:  ${message}`);
                    this.mqttC.publish(mower.mqtt_topics.command_in, message, mqtt.QoS.AtLeastOnce);
                } catch (error) {
                    this.log.info(`sendMessage normal:  ${error}`);
                    this.log.debug(`sendData normal:  ${JSON.stringify(message)}`);
                    this.mqttC.publish(mower.mqtt_topics.command_in, message, mqtt.QoS.AtLeastOnce);
                }
            } else {
                this.log.warn(`No mqtt connection found!!`);
            }
        } else {
            this.log.error("Try to send a message but could not find the mower");
        }
    }

    cleanup_json() {
        try {
            const delete_time = Date.now() - 24 * 60 * 1000 * 60;
            Object.keys(this.mqtt_response_check).forEach(async (key) => {
                if (
                    this.mqtt_response_check[key].request &&
                    this.mqtt_response_check[key].request > 0 &&
                    this.mqtt_response_check[key].request < delete_time
                ) {
                    delete this.mqtt_response_check[key];
                } else if (
                    this.mqtt_response_check[key].response &&
                    this.mqtt_response_check[key].response > 0 &&
                    this.mqtt_response_check[key].response < delete_time
                ) {
                    delete this.mqtt_response_check[key];
                }
            });
        } catch (e) {
            //Nothing
        }
    }

    /**
     * @param {object} data
     * @param {string} sent
     * @param {string} dataid
     * @param {string} [command=""]
     */
    async lastCommand(data, sent, dataid, command) {
        try {
            const data_json = data;
            const ids = dataid;
            const send = sent;
            let sn = "";
            if (data_json[ids]["sn"]) {
                sn = data_json[ids]["sn"];
            } else if (data_json[ids]["uuid"]) {
                sn = this.vision[data_json[ids]["uuid"]];
            } else {
                this.log.debug("No found sn!");
                return;
            }
            this.log.debug(`lastCommand_start:  ${JSON.stringify(data)}`);
            const lastcommand = await this.getStateAsync(`${sn}.mower.last_command`);
            let new_merge = [];
            if (lastcommand != null && lastcommand.val != null) {
                try {
                    new_merge = JSON.parse(lastcommand.val.toString());
                } catch (e) {
                    this.log.debug("DP last_command is not a string json");
                }
            }
            if (send === "other") {
                data_json[ids]["request"] = 0;
                data_json[ids]["response"] = Date.now();
                data_json[ids]["action"] = "APP";
                data_json[ids]["user"] = "APP";
                new_merge.push(data_json[ids]);
            } else if (send === "request") {
                data_json[ids][send] = Date.now();
                data_json[ids]["response"] = 0;
                data_json[ids]["action"] = command;
                data_json[ids]["user"] = "homebridge";
                new_merge.push(data_json[ids]);
            } else {
                const merge = new_merge.findIndex((request) => request.id === ids);
                if (merge && new_merge[merge] && new_merge[merge][send] != null) {
                    new_merge[merge][send] = Date.now();
                } else {
                    this.log.debug(`UNDEFINED:  ${JSON.stringify(data_json)}`);
                    this.log.debug(`UNDEFINED_id:  ${ids}`);
                    this.log.debug(`UNDEFINED_sent:  ${send}`);
                    return;
                }
            }
            if (new_merge.length > max_request) new_merge.shift();
            await this.setStateAsync(`${sn}.mower.last_command`, JSON.stringify(new_merge), true);
        } catch (e) {
            this.log.info("lastCommand: " + e);
            this.log.debug(e.stack);
        }
    }

    //Calendar
    /**
     * @param {object} mower
     * @param {Array} arr
     * @param {boolean} sec if sec is true, use second mowtime
     */
    async evaluateCalendar(mower, arr, sec) {
        if (arr) {
            const secString = sec ? "2" : "";

            for (let i = 0; i < this.week.length; i++) {
                await this.setStateAsync(`${mower.serial_number}.calendar.${this.week[i]}${secString}.startTime`, {
                    val: arr[i][0],
                    ack: true,
                });
                await this.setStateAsync(`${mower.serial_number}.calendar.${this.week[i]}${secString}.workTime`, {
                    val: arr[i][1],
                    ack: true,
                });
                await this.setStateAsync(`${mower.serial_number}.calendar.${this.week[i]}${secString}.borderCut`, {
                    val: arr[i][2] && arr[i][2] === 1 ? true : false,
                    ack: true,
                });
            }
        }
    }

    /**
     * @param {object} mower
     * @param {Array} arr
     */
    async evaluateVisionCalendar(mower, arr) {
        if (arr) {
            this.log.debug("COUNTER: " + arr.length);
            let x = 0;
            let y = 1;
            const new_schedule = [];
            for (let i = 0; i < this.week.length; i++) {
                const empty_schedule = {
                    e: 0,
                    d: 0,
                    s: 0,
                    t: 0,
                    cfg: {
                        cut: {
                            b: 0,
                            z: [],
                        },
                    },
                };
                let t = "00:00";
                let wt = 0;
                let cut = false;
                y = x + 1;
                if (arr[x] && parseFloat(arr[x].d) === i) {
                    t = this.formatDate(parseFloat(arr[x].s) * 60000, "hh:mm");
                    wt = arr[x].t;
                    cut = arr[x].cfg && arr[x].cfg.cut && arr[x].cfg.cut.b && arr[x].cfg.cut.b === 1 ? true : false;
                    this.log.debug(JSON.stringify(arr[x]));
                    new_schedule.push(arr[x]);
                    x++;
                } else {
                    empty_schedule.d = i;
                    new_schedule.push(empty_schedule);
                }
                await this.setStateAsync(`${mower.serial_number}.calendar.${this.week[i]}.startTime`, {
                    val: t,
                    ack: true,
                });
                await this.setStateAsync(`${mower.serial_number}.calendar.${this.week[i]}.workTime`, {
                    val: wt,
                    ack: true,
                });
                await this.setStateAsync(`${mower.serial_number}.calendar.${this.week[i]}.borderCut`, {
                    val: cut,
                    ack: true,
                });
                t = "00:00";
                wt = 0;
                cut = false;
                if (arr[y] && parseFloat(arr[y].d) === i) {
                    t = this.formatDate(parseFloat(arr[y].s) * 60000, "hh:mm");
                    wt = arr[y].t;
                    cut = arr[y].cfg && arr[y].cfg.cut && arr[y].cfg.cut.b && arr[y].cfg.cut.b === 1 ? true : false;
                    this.log.debug(JSON.stringify(arr[y]));
                    new_schedule.push(arr[y]);
                    x++;
                } else {
                    empty_schedule.d = i;
                    new_schedule.push(empty_schedule);
                }
                await this.setStateAsync(`${mower.serial_number}.calendar.${this.week[i]}2.startTime`, {
                    val: t,
                    ack: true,
                });
                await this.setStateAsync(`${mower.serial_number}.calendar.${this.week[i]}2.workTime`, {
                    val: wt,
                    ack: true,
                });
                await this.setStateAsync(`${mower.serial_number}.calendar.${this.week[i]}2.borderCut`, {
                    val: cut,
                    ack: true,
                });
            }
            arr = new_schedule;
            return arr;
        }
    }

    extractHidden(body) {
        const returnObject = {};
        if (body) {
            const matches = body.matchAll(/<input (?=[^>]* name=["']([^'"]*)|)(?=[^>]* value=["']([^'"]*)|)/g);
            for (const match of matches) {
                returnObject[match[1]] = match[2];
            }
        }
        return returnObject;
    }

    getCodeChallenge() {
        let hash = "";
        let result = "";
        const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        result = "";
        for (let i = 64; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
        result = Buffer.from(result).toString("base64");
        result = result.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
        hash = crypto.createHash("sha256").update(result).digest("base64");
        hash = hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

        return [result, hash];
    }

    randomClientid(min, max) {
        const length = Math.floor(Math.random() * (max - min + 1) + min);
        let result = "";
        const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }

    /**
     * @param {number} ms
     */
    sleep(ms) {
        return new Promise((resolve) => {
            this.sleepTimer = this.setTimeout(() => {
                resolve(true);
            }, ms);
        });
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.setState("info.connection", false, true);
            this.setState("info_mqtt.online", false, true);
            this.mqttC && this.mqttC.disconnect();
            this.refreshTokenTimeout && this.clearTimeout(this.refreshTokenTimeout);
            this.updateInterval && this.clearInterval(this.updateInterval);
            this.refreshActivity && this.clearInterval(this.refreshActivity);
            this.mqtt_restart && this.clearTimeout(this.mqtt_restart);
            this.sleepTimer && this.clearTimeout(this.sleepTimer);
            this.updateFW && this.clearInterval(this.updateFW);
            for (const mower of this.deviceArray) {
                this.pingInterval[mower.serial_number] && this.clearInterval(this.pingInterval[mower.serial_number]);
            }
            this.refreshTokenInterval && this.clearInterval(this.refreshTokenInterval);
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {HomeBridge.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (state && !state.ack && state.val !== null) {
            const no_verification = [
                "borderCut",
                "startTime",
                "workTime",
                "oneTimeWithBorder",
                "oneTimeWorkTime",
                "reset_battery_time",
                "reset_blade_time",
                "firmware_update_start",
            ];
            const command = id.split(".").pop();
            if (command == null) return;
            const check_time = Date.now() - this.poll_check_time;
            if (check_time < poll_check && !no_verification.includes(command)) {
                this.log.info(
                    `Min Time between requests is 1000ms. The time between commands was ${check_time} ms. Request ${id} with value ${state.val} was not sended`,
                );
                return;
            }
            this.poll_check_time = Date.now();
            const mower_id = id.split(".")[2];
            const mower = this.deviceArray.find((device) => device.serial_number === mower_id);
            this.log.debug(`this.modules!  ${JSON.stringify(this.modules)}`);
            this.log.debug(
                `state change: id_____ ${id} Mower ${mower_id}_____${command}______${JSON.stringify(mower)}`,
            );

            if (mower) {
                try {
                    if (command == "state") {
                        if (state.val === true) {
                            this.startMower(mower, id);
                        } else {
                            this.stopMower(mower, id);
                        }
                    } else if (command == "paused") {
                        const pause = typeof state.val === "number" ? state.val : parseInt(state.val.toString());
                        if (pause > 0) {
                            this.sendMessage(`{"sc":{ "paused":${pause}}}`, mower.serial_number, id);
                        }
                    } else if (command == "waitRain") {
                        const rain = typeof state.val === "number" ? state.val : parseInt(state.val.toString());
                        const val = rain < 0 ? 90 : rain;
                        if (val % 30 != 0) {
                            this.log.warn(`Wait Time: Time only in 30 second increments!`);
                            return;
                        }
                        if (typeof val == "number" && val > 720) {
                            this.log.warn("Rain time more than 12 hours is not allowed!");
                            return;
                        }
                        this.sendMessage(`{"rd":${val}}`, mower.serial_number, id);
                        this.log.debug(`Changed time wait after rain to:${val}`);
                    } else if (command === "borderCut" || command === "startTime" || command === "workTime") {
                        if (mower.capabilities != null && mower.capabilities.includes("vision")) {
                            this.changeVisionCfg(id, state.val, mower, false);
                        } else {
                            this.changeMowerCfg(id, state.val, mower, false);
                        }
                    } else if (command === "calJson_sendto" && state.val) {
                        if (mower.capabilities != null && mower.capabilities.includes("vision")) {
                            this.changeVisionCfg(id, state.val, mower, true);
                        } else {
                            this.changeMowerCfg(id, state.val, mower, true);
                        }
                    } else if (
                        command === "area_0" ||
                        command === "area_1" ||
                        command === "area_2" ||
                        command === "area_3"
                    ) {
                        const area = typeof state.val === "number" ? state.val : parseInt(state.val.toString());
                        this.changeMowerArea(id, area, mower);
                    } else if (command === "startSequence") {
                        if (mower.capabilities != null && mower.capabilities.includes("vision")) {
                            this.startSequencesVision(id, state.val, mower);
                        } else {
                            this.startSequences(id, state.val, mower);
                        }
                    } else if (command === "manuell_update") {
                        const lastTime = await this.getStateAsync(`${mower.serial_number}.activityLog.last_update`);
                        if (state.val && lastTime && lastTime.val && Date.now() - Number(lastTime.val) > not_allowed) {
                            this.createActivityLogStates(mower);
                            this.setState(`${mower.serial_number}.activityLog.manuell_update`, {
                                val: false,
                                ack: true,
                            });
                        } else {
                            const nextTime = not_allowed / 1000;
                            this.log.info(`Manuell update < ${nextTime} sec. is not allowed`);
                        }
                    } else if (command === "pause") {
                        if (state.val === true) {
                            this.sendMessage('{"cmd":2}', mower.serial_number, id);
                        }
                    } else if (command === "mowTimeExtend") {
                        const mowTimeExtend =
                            typeof state.val === "number" ? state.val : parseInt(state.val.toString());
                        this.mowTimeEx(id, mowTimeExtend, mower);
                    } else if (
                        command === "mowerActive" &&
                        mower.last_status.payload &&
                        mower.last_status.payload.cfg &&
                        mower.last_status.payload.cfg.sc
                    ) {
                        const val = state.val ? 1 : 0;
                        const message = mower.last_status.payload.cfg.sc;

                        //hotfix 030620
                        delete message.ots;
                        delete message.distm;
                        message.m = val;
                        this.log.debug(`Mow times disabled: ${message.m}`);
                        this.sendMessage(`{"sc":${JSON.stringify(message)}}`, mower.serial_number, id);
                    } else if (command === "edgecut") {
                        this.edgeCutting(id, state.val, mower);
                    } else if (command === "sendCommand") {
                        this.sendCommand(state.val, mower, id);
                    } else if (command === "oneTimeStart" || command === "oneTimeJson") {
                        this.startOneShedule(id, state.val, mower);
                    } else if (command === "partyModus") {
                        this.sendPartyModus(id, state.val, mower);
                    } else if (command === "calJson" || command === "calJson2") {
                        this.changeWeekJson(id, state.val, mower);
                    } else if (command === "AutoLock") {
                        const msg = this.modules[mower.serial_number].al;
                        msg.lvl = state.val ? 1 : 0;
                        if (msg.t % 30 != 0) {
                            this.log.warn(`Lock Time: Time only in 30 second increments!`);
                            return;
                        }
                        if ((msg.t < 0 || msg.t > 600) && msg.lvl === 1) {
                            msg.t = 300;
                        } else if (msg.lvl === 0) {
                            msg.t = 0;
                        }
                        this.sendMessage(`{"al":${JSON.stringify(msg)}}`, mower.serial_number, id);
                    } else if (
                        command === "log_improvement" &&
                        mower.last_status.payload &&
                        mower.last_status.payload.cfg &&
                        mower.last_status.payload.cfg.log &&
                        mower.last_status.payload.cfg.log.imp != null
                    ) {
                        const msg = mower.last_status.payload.cfg.log;
                        msg.imp = state.val ? 1 : 0;
                        this.sendMessage(`{"log":${JSON.stringify(msg)}}`, mower.serial_number, id);
                    } else if (
                        command === "log_troubleshooting" &&
                        mower.last_status.payload &&
                        mower.last_status.payload.cfg &&
                        mower.last_status.payload.cfg.log &&
                        mower.last_status.payload.cfg.log.diag != null
                    ) {
                        const msg = mower.last_status.payload.cfg.log;
                        msg.diag = state.val ? 1 : 0;
                        this.sendMessage(`{"log":${JSON.stringify(msg)}}`, mower.serial_number, id);
                    } else if (command === "AutoLockTimer") {
                        const lock = typeof state.val === "number" ? state.val : parseInt(state.val.toString());
                        if (lock < 0 || lock > 600) {
                            this.log.warn("Please use value between 0 and 600 for Autolocktimer");
                            return;
                        }
                        const msg = this.modules[mower.serial_number].al;
                        msg.t = typeof state.val === "number" ? state.val : parseInt(state.val.toString());
                        if (msg.lvl === 0) msg.lvl = 1;
                        if (msg.t % 30 != 0) {
                            this.log.warn(`Lock Time: Time only in 30 second increments!`);
                            return;
                        }
                        this.sendMessage(`{"al":${JSON.stringify(msg)}}`, mower.serial_number, id);
                    } else if (command === "hl") {
                        const msg = {};
                        msg.enabled = state.val;
                        this.sendMessage(`{"modules":{"HL":${JSON.stringify(msg)}}}`, mower.serial_number, id);
                    } else if (command === "slab") {
                        const msg = {};
                        msg.slab = state.val;
                        this.sendMessage(`{"vis":${msg}}`, mower.serial_number, id);
                    } else if (command === "OLMSwitch_Cutting" && this.modules[mower.serial_number].DF) {
                        const msg = this.modules[mower.serial_number].DF;
                        msg.cut = state.val ? 1 : 0;
                        this.sendMessage(`{"modules":{"DF":${JSON.stringify(msg)}}}`, mower.serial_number, id);
                    } else if (command === "OLMSwitch_FastHoming" && this.modules[mower.serial_number].DF) {
                        const msg = this.modules[mower.serial_number].DF;
                        msg.fh = state.val ? 1 : 0;
                        this.sendMessage(`{"modules":{"DF":${JSON.stringify(msg)}}}`, mower.serial_number, id);
                    } else if (command === "ACS" && this.modules[mower.serial_number].US) {
                        const msg = this.modules[mower.serial_number].US;
                        msg.enabled = state.val || 0;
                        this.sendMessage('{"modules":{"US":' + JSON.stringify(msg) + "}}", mower.serial_number, id);
                    } else if (command === "mqtt_update") {
                        this.refreshMqttData(mower, id);
                    } else if (command === "torque") {
                        const torque = typeof state.val === "number" ? state.val : parseInt(state.val.toString());
                        if (torque < -50 || torque > 50) return;
                        const tqval = typeof state.val === "number" ? state.val : parseInt(state.val.toString());
                        this.sendMessage(`{"tq":${tqval}}`, mower.serial_number, id);
                    } else if (command === "reset_battery_time" && state.val) {
                        await this.setStateAsync(`${mower.serial_number}.mower.reset_battery_time`, {
                            ack: true,
                        });
                    } else if (command === "reset_blade_time" && state.val) {
                        await this.setStateAsync(`${mower.serial_number}.mower.reset_blade_time`, {
                            ack: true,
                        });
                    } else if (command === "firmware_update_start" && state.val) {
                        this.checkfirmware(mower);
                    } else if (
                        (command === "reset_blade_time_approved" ||
                            command === "reset_battery_time_approved" ||
                            command === "firmware_update_start_approved") &&
                        state.val
                    ) {
                        this.postRequest(command, mower.serial_number);
                    } else if (command === "zoneKeeper") {
                        const keeper = state.val ? 1 : 0;
                        if (
                            mower.last_status != null &&
                            mower.last_status.payload != null &&
                            mower.last_status.payload.cfg != null &&
                            mower.last_status.payload.cfg.mz != null
                        ) {
                            const area = mower.last_status.payload.cfg.mz;
                            const sum = area.reduce((pv, cv) => {
                                return Number(pv) + Number(cv);
                            }, 0);
                            if (keeper && sum === 0) {
                                this.log.info("Areas are disable! At least one area must be activated!");
                                return;
                            }
                            this.sendMessage(`{"mzk":${keeper}}`, mower.serial_number, id);
                        } else {
                            this.log.debug("Area array not found!");
                        }
                    }
                } catch (error) {
                    this.log.error(`Error in ${id} ${error}`);
                    this.log.error(error.stack);
                }
            } else {
                this.log.error(`No mower found!  ${JSON.stringify(mower_id)}`);
                this.log.info(`Mower list ${JSON.stringify(this.deviceArray)}`);
            }
        }
    }

    /**
     * @param {string} id
     * @param {object} state
     * @param {object} mower
     */
    startSequencesVision(id, state, mower) {
        let mz = {};
        try {
            mz = JSON.parse(state);
        } catch (e) {
            this.log.warn(`Cannot parse json startSequencesVision: ${JSON.stringify(state)}`);
            return;
        }
        let isOK = true;
        let first = true;
        let isCS = 0;
        let isBC = 0;
        let check_id = 1;
        if (mz) {
            if (mz.p && Array.isArray(mz.p)) {
                if (mz.s && Array.isArray(mz.s)) {
                    for (const id of mz.s) {
                        if (
                            id.id == null ||
                            id.c == null ||
                            !id.cfg ||
                            !id.cfg.cut ||
                            id.cfg.cut.bd == null ||
                            id.cfg.cut.ob == null
                        ) {
                            isOK = false;
                            this.log.warn(`startsequenceVision: Missing key - ${JSON.stringify(state)}`);
                            continue;
                        }
                        if (first) {
                            first = false;
                            isBC = id.cfg.cut.ob;
                        }
                        if (id.id > check_id) {
                            isOK = false;
                            this.log.warn(
                                `startsequenceVision: Key s is sorted incorrectly - ${JSON.stringify(state)}`,
                            );
                        }
                        if (id.cfg.cut.bd != 100 && id.cfg.cut.bd != 150 && id.cfg.cut.bd != 200) {
                            isOK = false;
                            this.log.warn(
                                `startsequenceVision: BorderCut - ${JSON.stringify(
                                    id.cfg.cut.bd,
                                )} is not allowed. Allowed is 100, 150 and 200!`,
                            );
                        } else if (id.cfg.cut.ob != isBC) {
                            isOK = false;
                            this.log.warn(
                                `startsequenceVision: Different "go over slabs" per-zone is not allowed - ${JSON.stringify(
                                    state,
                                )}`,
                            );
                        } else if (id.cfg.cut.ob > 1) {
                            isOK = false;
                            this.log.warn(
                                `startsequenceVision: Key ob greather 1 is not allowed - ${JSON.stringify(
                                    id.cfg.cut.ob,
                                )}`,
                            );
                        } else if (id.c > 1) {
                            isOK = false;
                            this.log.warn(
                                `startsequenceVision: Key c greather 1 is not allowed - ${JSON.stringify(id.c)}`,
                            );
                        } else if (id.c == 1 && isCS == 0) {
                            isCS = 1;
                        } else if (id.c > 0 && isCS == 1) {
                            isOK = false;
                            this.log.warn(
                                `startsequenceVision: Charging station only possible in one zone - ${JSON.stringify(
                                    state,
                                )}`,
                            );
                        }
                        ++check_id;
                        isBC = id.cfg.cut.ob;
                        if (!isOK) {
                            break;
                        }
                    }
                } else {
                    this.log.warn(`startsequenceVision: Missing key s - ${JSON.stringify(state)}`);
                    isOK = false;
                }
            } else {
                this.log.warn(`startsequenceVision: Missing key p - ${JSON.stringify(state)}`);
                isOK = false;
            }
        } else {
            this.log.warn(`startsequenceVision: Missing key mz - ${JSON.stringify(state)}`);
            isOK = false;
        }
        if (isOK) {
            this.log.debug(`startsequenceVision send: - ${JSON.stringify(state)}`);
            this.sendMessage(`{"mz":${JSON.stringify(mz)}}`, mower.serial_number, id);
        }
    }

    /**
     * @param {object} mower
     */
    async checkfirmware(mower) {
        const fw = await this.getStateAsync(`${mower.serial_number}.mower.firmware`);
        const fw_ava = await this.getStateAsync(`${mower.serial_number}.mower.firmware_available`);
        if (!fw || !fw_ava || fw == fw_ava) {
            this.log.debug(`No update found. Start request to Worx.`);
            this.updateFirmware();
            await this.setStateAsync(`${mower.serial_number}.mower.firmware_update_start`, {
                val: false,
                ack: true,
            });
            return;
        }
        await this.setStateAsync(`${mower.serial_number}.mower.firmware_update_start`, {
            ack: true,
        });
    }

    /**
     * @param {string} command
     * @param {string} device
     */
    async postRequest(command, device) {
        let status = null;
        let check = null;
        if (command === "reset_blade_time_approved") {
            status = await this.getStateAsync(`${device}.mower.reset_blade_time`);
            if (status != null && status.val) {
                this.log.debug(`Reset blade time!`);
                check = await this.apiRequest(`product-items/${device}/counters/blade/reset`, false, "post");
                this.log.debug(`Receive: Reset blade time - ${JSON.stringify(check)}`);
                if (check) {
                    await this.setStateAsync(`${device}.mower.reset_blade_time`, {
                        val: false,
                        ack: true,
                    });
                    await this.setStateAsync(`${device}.mower.reset_blade_time_approved`, {
                        val: false,
                        ack: true,
                    });
                }
            }
        } else if (command === "reset_battery_time_approved") {
            status = await this.getStateAsync(`${device}.mower.reset_battery_time`);
            if (status != null && status.val) {
                this.log.debug(`Reset battery time!`);
                check = await this.apiRequest(`product-items/${device}/counters/battery/reset`, false, "post");
                this.log.debug(`Receive: Reset battery time - ${JSON.stringify(check)}`);
                if (check) {
                    await this.setStateAsync(`${device}.mower.reset_battery_time`, {
                        val: false,
                        ack: true,
                    });
                    await this.setStateAsync(`${device}.mower.reset_battery_time_approved`, {
                        val: false,
                        ack: true,
                    });
                }
            }
        } else if (command === "firmware_update_start_approved") {
            status = await this.getStateAsync(`${device}.mower.firmware_update_start`);
            if (status != null && status.val) {
                this.log.debug(`Start Firmware Update!`);
                check = await this.apiRequest(`product-items/${device}/firmware-upgrade`, false, "post");
                this.log.debug(`Receive: Start Firmware Update - ${JSON.stringify(check)}`);
                if (check != null) {
                    this.log.debug(`Start firmware update has been sent.`);
                } else {
                    this.log.debug(`Unknown error during update!`);
                }
            }
            await this.setStateAsync(`${device}.mower.firmware_update_start`, {
                val: false,
                ack: true,
            });
            await this.setStateAsync(`${device}.mower.firmware_update_start_approved`, {
                val: false,
                ack: true,
            });
            return;
        }
        if (check && check["serial_number"] != null) {
            const new_data = await this.cleanupRaw(check);
            this.json2iob.parse(`${check["serial_number"]}.rawMqtt`, new_data, {
                forceIndex: true,
                preferedArrayName: null,
            });
        } else {
            this.log.info(`The reset didn't work.`);
        }
    }

    /**
     * @param {object} mower
     * @param {string} command
     */
    async refreshMqttData(mower, command) {
        if (!mower && !mower.serial_number) {
            this.log.debug("refreshMqttData: Could not find a mower");
            return;
        }
        try {
            const actual_ts = Date.now();
            // ToDo delete namespace
            const value_check = await this.getObjectAsync(
                this.namespace + "." + mower.serial_number + ".mower.mqtt_update_count",
            );
            if (value_check) {
                if (actual_ts - 86400000 > value_check.native.NEXT) {
                    // every 10min 1000*60*10*144 = 86400000
                    value_check.native.NEXT = actual_ts;
                    value_check.native.MIN = 0;
                    value_check.native.TIMES = 0;
                    this.log.debug("Start new counter");
                }
                const date = new Date(value_check.native.NEXT + 86400000);
                const next_start =
                    date.getDate() +
                    "/" +
                    (date.getMonth() + 1) +
                    "/" +
                    date.getFullYear() +
                    " " +
                    date.getHours() +
                    ":" +
                    date.getMinutes() +
                    ":" +
                    date.getSeconds();
                if (value_check.native.MAX > 200 || value_check.native.MAX < 200) value_check.native.MAX = 200;
                if (value_check.native.NEXT === 0) value_check.native.NEXT = actual_ts;
                if (actual_ts - value_check.native.TIMES < mqtt_poll_max) {
                    this.log.info("Updating less than 1 minute is not allowed.");
                    return;
                }
                ++value_check.native.MIN;
                if (value_check.native.MIN > value_check.native.MAX) {
                    this.log.info("Max. 200 updates for today have been used. Next refresh possible: " + next_start);
                    return;
                }
                value_check.native.TIMES = actual_ts;
                // ToDo change setForeignObjectAsync to extendObject
                await this.setForeignObjectAsync(
                    this.namespace + "." + mower.serial_number + ".mower.mqtt_update_count",
                    value_check,
                );
                this.setState(`${mower.serial_number}.mower.mqtt_update_count`, {
                    val: value_check.native.MIN,
                    ack: true,
                });
                this.setState(`${mower.serial_number}.mower.mqtt_update`, {
                    val: false,
                    ack: true,
                });
            }
            this.sendPing(mower, false, "", command);
        } catch (e) {
            this.log.error("refreshMqttData: " + e);
        }
    }

    async sendPing(mower, no_send, merge_message, command) {
        const language =
            mower.last_status &&
            mower.last_status.payload &&
            mower.last_status.payload.cfg &&
            mower.last_status.payload.cfg.lg
                ? mower.last_status.payload.cfg.lg
                : "de";
        const mowerSN = mower.serial_number;
        const now = new Date();
        let vision = {};
        if (mower.capabilities != null && mower.capabilities.includes("vision")) {
            vision = {
                uuid: mower.uuid,
                tm: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString(),
            };
        } else {
            vision = {
                sn: mowerSN,
                // Important: Send the time in your local timezone, otherwise mowers clock will be wrong.
                tm: `${("0" + now.getHours()).slice(-2)}:${("0" + now.getMinutes()).slice(-2)}:${(
                    "0" + now.getSeconds()
                ).slice(-2)}`,
                dt: `${("0" + now.getDate()).slice(-2)}/${("0" + (now.getMonth() + 1)).slice(-2)}/${now.getFullYear()}`,
            };
        }
        const message = {
            id: 1024 + Math.floor(Math.random() * (65535 - 1025)),
            cmd: 0,
            lg: language,
            ...vision,
            ...merge_message,
        };
        this.log.debug("Start MQTT ping: " + JSON.stringify(message));
        if (no_send) {
            return message;
        } else {
            this.sendMessage(JSON.stringify(message), mowerSN, command);
        }
    }

    /**
     * @param {object} mower
     * @param {string} command
     */
    async startMower(mower, command) {
        this.log.debug(`Start mower ${JSON.stringify(mower)}`);

        if (
            mower.last_status.payload &&
            mower.last_status.payload.dat &&
            (mower.last_status.payload.dat.ls === 1 || mower.last_status.payload.dat.ls === 34) &&
            mower.last_status.payload.dat.le === 0
        ) {
            this.sendMessage('{"cmd":1}', mower.serial_number, command); //start code for mower
            this.log.debug("Start mower");
        } else {
            this.log.warn(
                "Can not start mower because he is not at home or there is an error please verify mower state",
            );
            this.setState(`${mower.serial_number}.mower.state`, {
                val: false,
                ack: true,
            });
        }
    }

    /**
     * @param {object} mower
     * @param {string} command
     */
    stopMower(mower, command) {
        if (
            mower.last_status.payload &&
            mower.last_status.payload.dat &&
            mower.last_status.payload.dat.ls === 7 &&
            mower.last_status.payload.dat.le === 0
        ) {
            this.sendMessage('{"cmd":3}', mower.serial_number, command); //"Back to home" code for mower
            this.log.debug("mower going back home");
        } else {
            this.log.warn("Can not stop mower because he did not mow or there is an error");
            this.setState(`${mower.serial_number}.mower.state`, {
                val: true,
                ack: true,
            });
        }
    }

    /**
     * @param {string} id id of state
     * @param {object} mower object of mower that changed
     * @param {any} value string of Json
     */
    async startOneShedule(id, value, mower) {
        let msgJson;
        const idType = id.split(".")[4];

        if (idType === "oneTimeStart") {
            const bc = await this.getStateAsync(`${mower.serial_number}.mower.oneTimeWithBorder`);
            const wtm = await this.getStateAsync(`${mower.serial_number}.mower.oneTimeWorkTime`);
            if (bc && wtm) {
                if (wtm.val === 0) {
                    this.log.info("Datapoint oneTimeWorkTime with value 0 is not allowed!");
                    return;
                }
                if (typeof wtm.val == "number" && wtm.val % 30 != 0) {
                    this.log.warn(`Work Time: Time only in 30 second increments!`);
                    return;
                }
                if (typeof wtm.val == "number" && wtm.val > 480) {
                    this.log.warn("Working time more than 8 hours is not allowed!");
                    return;
                }
                if (mower.capabilities != null && mower.capabilities.includes("vision")) {
                    msgJson = {
                        once: {
                            time: wtm.val,
                            cfg: {
                                cut: {
                                    b: bc.val ? 1 : 0,
                                    z: [],
                                },
                            },
                        },
                    };
                } else {
                    msgJson = {
                        ots: {
                            bc: bc.val ? 1 : 0,
                            wtm: wtm.val,
                        },
                    };
                }
            }
        } else if (idType === "oneTimeJson") {
            try {
                let time_check = null;
                let border_check = null;
                if (mower.capabilities != null && mower.capabilities.includes("vision")) {
                    msgJson = JSON.parse(value);
                    msgJson = { once: { ...msgJson } };
                    time_check = msgJson.once.time;
                    border_check = msgJson.once.cfg.cut.b;
                } else {
                    msgJson = JSON.parse(value);
                    msgJson = { ots: { ...msgJson } };
                    time_check = msgJson.ots.wtm;
                    border_check = msgJson.ots.bc;
                }
                if (time_check == null || border_check == null) {
                    this.log.error('ONETIMESHEDULE: NO vailed format. Must contain "bc" and "wtm" or "time" and "b"');
                    return;
                }
                if (time_check === 0) {
                    this.log.info("Datapoint oneTimeJson (wtm or time) with value 0 is not allowed!");
                    return;
                }
                if (typeof time_check == "number" && time_check % 30 != 0) {
                    this.log.warn(`Work Time: Time only in 30 second increments!`);
                    return;
                }
                if (typeof time_check == "number" && time_check > 480) {
                    this.log.warn("Working time more than 8 hours is not allowed!");
                    return;
                }
            } catch (error) {
                this.log.error("ONETIMESCHEDULE: NO vailed JSON format");
                return;
            }
        }

        this.log.debug(`ONETIMESCHEDULE: ${JSON.stringify(msgJson)}`);
        this.sendMessage(`{"sc":${JSON.stringify(msgJson)}}`, mower.serial_number, id);
    }

    /**
     * @param {string} id id of state
     * @param {object} mower object of mower that changed
     * @param {any} value string of Json
     */
    async changeWeekJson(id, value, mower) {
        if (mower && mower.auto_schedule) {
            this.log.info(`Automatic mowing plan active! Times cannot be changed.`);
            return;
        }
        let msgJson;
        const sheduleSel = id.split(".")[4].search("2") === -1 ? "d" : "dd";
        let fail = false;
        // const idType = id.split(".")[4];
        if (
            !mower.last_status ||
            !mower.last_status.payload ||
            !mower.last_status.payload.cfg ||
            !mower.last_status.payload.cfg.sc
        ) {
            // check if config exist
            this.log.warn(
                `Cant send command because cfg.sc is missing from cloud exist please try again later. last message: ${JSON.stringify(
                    mower.last_status,
                )}`,
            );
            return;
        }
        const message = mower.last_status.payload.cfg.sc;

        message.ots && delete message.ots;
        message.distm && delete message.distm;

        try {
            msgJson = JSON.parse(value);
            if (msgJson.length !== 7) {
                this.log.error("CALJSON: Json length not correct must be 7 Days");
                fail = true;
            }

            for (const element of msgJson) {
                this.log.debug(`CALJSON: ${JSON.stringify(element)}`);
                if (element.length !== 3) {
                    this.log.error("CALJSON: Arguments missing!!");
                    fail = true;
                }
                if (element[2] === 0 || element[2] === 1) {
                    // no vailed border value
                } else {
                    this.log.error("CALJSON: Bordercut shoulg be 0 or 1!!");
                    fail = true;
                }
                const h = element[0].split(":")[0];
                const m = element[0].split(":")[1];
                this.log.debug(`h: ${h} m: ${m}`);
                if (h < 0 || h > 23 || m < 0 || m > 59) {
                    this.log.error("CALJSON: Start time is not correct!!");
                    fail = true;
                }

                if (element[1] < 0 || element[1] > 1440) {
                    this.log.error("Time out of range 0 min < time < 1440 min.");
                    fail = true;
                }
            }

            this.log.debug(`CALJSON length: ${msgJson.length}`);
        } catch (error) {
            this.log.error("CALJSON: NO vailed JSON format");
            fail = true;
        }

        fail && this.log.debug(`FAIL: ${fail} CALJSON: ${JSON.stringify(msgJson)}`);
        message[sheduleSel] = msgJson;
        if (!fail) this.sendMessage(`{"sc":${JSON.stringify(message)}}`, mower.serial_number, id);
    }

    /**
     * @param {string} id id of state
     * @param {any} value value that changed
     * @param {object} mower object of mower that changed
     * @param {boolean} send
     */
    async changeVisionCfg(id, value, mower, send) {
        if (!mower.last_status) {
            // check if config exist
            this.log.warn(`Missing last_status from mower ${mower.serial_number} cannot send command`);
            return;
        }
        if (
            !mower.last_status.payload ||
            mower.last_status.payload.cfg == null ||
            mower.last_status.payload.cfg.sc == null ||
            mower.last_status.payload.cfg.sc.slots == null
        ) {
            // check if config exist
            this.log.warn(
                `Cant send command because no Configdata from cloud exist please try again later. last message: ${JSON.stringify(
                    mower.last_status.payload,
                )}`,
            );
            return;
        }
        if (mower && mower.auto_schedule && send) {
            this.log.info(`Automatic mowing plan active! Times cannot be changed.`);
            return;
        }
        if (send) {
            const message = await this.getStateAsync(`${mower.serial_number}.calendar.calJson_tosend`);
            const schedule_new = [];
            if (message != null && message.val != null && message.val != "") {
                try {
                    let message_dp;
                    if (typeof message.val === "object") {
                        message_dp = JSON.parse(JSON.stringify(message.val));
                    } else if (typeof message.val === "string") {
                        message_dp = JSON.parse(message.val);
                    }
                    for (const slot of message_dp) {
                        if (slot.s !== 0 && slot.t !== 0) {
                            slot.e = 1;
                            this.log.debug(JSON.stringify(slot));
                            schedule_new.push(slot);
                        }
                    }
                    this.log.debug(`Send Schedule: ${JSON.stringify(schedule_new)}`);
                    this.sendMessage(`{"sc":{"slots":${JSON.stringify(schedule_new)}}}`, mower.serial_number, id);
                    this.setState(`${mower.serial_number}.calendar.calJson_sendto`, {
                        val: false,
                        ack: true,
                    });
                } catch (e) {
                    this.log.info(`Send new schedule is not possible!`);
                }
            }
            return;
        }
        const arr = id.split(".");
        const scheduleSelect = arr[4].search("2") === -1 ? 0 : 1;
        const message = mower.last_status.payload.cfg.sc.slots;
        let dayID = this.week.indexOf(arr[4].replace(/2/g, ""));
        dayID = dayID + dayID + scheduleSelect;
        this.log.debug(`day: ${arr[4].replace(/2/g, "")} scheduleSelect: ${scheduleSelect} dID: ${dayID}`);
        try {
            if (arr[5] === "borderCut") {
                message[dayID].cfg.cut.b = value ? 1 : 0;
            } else if (arr[5] === "workTime") {
                const max = 1440 - message[dayID].s;
                this.log.debug(`value: ${value} max: ${max} dID: ${dayID}`);
                if (value >= 0 && value <= max) {
                    message[dayID].t = parseInt(value);
                } else {
                    this.log.error("Time out of range 0 min < time < 1440 min.");
                    return;
                }
            } else if (arr[5] === "startTime") {
                const t = value.split(":");
                const h = parseInt(t[0]);
                const m = parseInt(t[1]);
                this.log.debug(`h: ${h} m: ${m} dID: ${dayID}`);
                if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                    message[dayID].s = h * 60 + m;
                } else {
                    this.log.error('Time out of range: e.g "10:00"');
                    return;
                }
            } else {
                this.log.error("Something went wrong while setting new mower times");
                return;
            }
        } catch (e) {
            this.log.error(`Error while setting mower time: ${e}`);
            return;
        }
        this.log.debug(`Mowing time change at ${scheduleSelect} to: ${JSON.stringify(message)}`);
        this.setState(`${mower.serial_number}.calendar.calJson_tosend`, {
            val: JSON.stringify(message),
            ack: true,
        });
    }

    /**
     * @param {string} id id of state
     * @param {any} value value that changed
     * @param {object} mower object of mower that changed
     * @param {boolean} send
     */
    async changeMowerCfg(id, value, mower, send) {
        const val = value;
        let sval;
        let dayID;

        if (!mower.last_status) {
            // check if config exist
            this.log.warn(`Missing last_status from mower ${mower.serial_number} cannot send command`);
            return;
        }
        if (!mower.last_status.payload || mower.last_status.payload.cfg == null) {
            // check if config exist
            this.log.warn(
                `Cant send command because no Configdata from cloud exist please try again later. last message: ${JSON.stringify(
                    mower.last_status.payload,
                )}`,
            );
            return;
        }
        if (mower && mower.auto_schedule && send) {
            this.log.info(`Automatic mowing plan active! Times cannot be changed.`);
            return;
        }
        if (send) {
            const message = await this.getStateAsync(`${mower.serial_number}.calendar.calJson_tosend`);
            if (message != null && message.val != "") {
                try {
                    this.sendMessage(`{"sc":${message.val}}`, mower.serial_number, id);
                    this.setState(`${mower.serial_number}.calendar.calJson_sendto`, {
                        val: false,
                        ack: true,
                    });
                } catch (e) {
                    this.log.info(`Send new schedule is not possible!`);
                }
            }
            return;
        }
        //find number 2 for second shedule
        const sheduleSel = id.split(".")[4].search("2") === -1 ? "d" : "dd";
        const message = mower.last_status.payload.cfg.sc; // set actual values
        //let fullMessage = mower.last_status.payload.cfg.sc;

        if (message == null) {
            this.log.warn("try again later!");
            return;
        }
        message.ots && delete message.ots;
        message.distm && delete message.distm;

        const valID = ["startTime", "workTime", "borderCut"].indexOf(id.split(".")[5]);

        if (sheduleSel === "d") {
            dayID = this.week.indexOf(id.split(".")[4]);
        } else {
            const modWeekday = id.split(".")[4];

            //erase the number 2
            dayID = this.week.indexOf(modWeekday.substring(0, modWeekday.length - 1));
        }

        try {
            if (valID === 2) {
                // changed the border cut
                sval = valID === 2 && val === true ? 1 : 0;
            } else if (valID === 0) {
                // changed the start time
                const h = val.split(":")[0];
                const m = val.split(":")[1];
                this.log.debug(`h: ${h} m: ${m}`);
                if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                    sval = val;
                } else this.log.error('Time out of range: e.g "10:00"');
            } else if (valID === 1) {
                // changed the worktime
                if (val >= 0 && val <= 1440) {
                    sval = parseInt(val);
                } else this.log.error("Time out of range 0 min < time < 1440 min.");
            } else this.log.error("Something went wrong while setting new mower times");
        } catch (e) {
            this.log.error(`Error while setting mower config: ${e}`);
        }
        if (sval !== undefined) {
            if (
                message[sheduleSel] == null ||
                message[sheduleSel][dayID] == null ||
                message[sheduleSel][dayID][valID] == null
            ) {
                this.log.warn("Something went wrong, please try again later");
                return;
            }
            message[sheduleSel][dayID][valID] = sval;
            this.log.debug(`Mowing time change at ${sheduleSel} to: ${JSON.stringify(message)}`);
            this.setState(`${mower.serial_number}.calendar.calJson_tosend`, {
                val: JSON.stringify(message),
                ack: true,
            });
        }
        this.log.debug(`test cfg: ${dayID} valID: ${valID} val: ${val} sval: ${sval}`);
    }

    /**
     * @param {string} id
     * @param {any} value
     * @param {any} mower
     */
    changeMowerArea(id, value, mower) {
        const val = value;

        if ((mower.last_status.payload && mower.last_status.payload.cfg == null) || mower.last_status.payload == null) {
            // check if config exist
            this.log.warn(
                `Cant send command because no Configdata from cloud exist please try again later. last message: ${JSON.stringify(
                    mower.last_status.payload,
                )}`,
            );
            return;
        }

        const message = mower.last_status.payload.cfg.mz; // set actual values
        const areaID = Number(id.split("_").pop());

        try {
            if (!isNaN(val) && val >= 0 && val <= 500) {
                message[areaID] = val;
                this.sendMessage(`{"mz":${JSON.stringify(message)}}`, mower.serial_number, id);
                this.log.debug(`Change Area ${areaID} : ${JSON.stringify(message)}`);
            } else {
                this.log.warn("Area Value ist not correct, please type in a val between 0 and 500");
                this.setState(`${mower.serial_number}.areas.area_${areaID}`, {
                    val:
                        mower.last_status.payload.cfg.mz && mower.last_status.payload.cfg.mz[areaID]
                            ? mower.last_status.payload.cfg.mz[areaID]
                            : 0,
                    ack: true,
                });
            }
        } catch (e) {
            this.log.error(`Error while setting mower areas: ${e}`);
        }
    }

    /**
     * @param {string} id
     * @param {any} value
     * @param {any} mower
     */
    sendPartyModus(id, value, mower) {
        if (mower.capabilities != null && mower.capabilities.includes("vision")) {
            const val = value ? 0 : 1;
            this.sendMessage(`{"sc":{ "enabled":${val}}}`, mower.serial_number, id);
        } else if (value) {
            this.sendMessage('{"sc":{ "m":2, "distm": 0}}', mower.serial_number, id);
        } else {
            this.sendMessage('{"sc":{ "m":1, "distm": 0}}', mower.serial_number, id);
        }
    }

    /**
     * @param {string} id
     * @param {any} value
     * @param {object} mower
     */
    startSequences(id, value, mower) {
        if (mower.last_status.payload.cfg == null) {
            // check if config exist
            this.log.warn(
                `Cant send command because no Configdata from cloud exist please try again later. last message: ${JSON.stringify(
                    mower.last_status.payload,
                )}`,
            );
            return;
        }

        // const message = mower.last_status.payload.cfg.mz; // set aktual values
        let seq = [];
        try {
            seq = JSON.parse(value);
        } catch (e) {
            try {
                seq = JSON.parse(`[${value}]`);
            } catch (e) {
                this.log.error(`Error while setting start sequence: ${e}`);
            }
        }

        try {
            for (let i = 0; i < 10; i++) {
                if (seq[i] != undefined) {
                    if (isNaN(seq[i]) || seq[i] < 0 || seq[i] > 3) {
                        seq[i] = 0;
                        this.log.error(`Wrong start sequence, set val ${i} to 0`);
                    }
                } else {
                    seq[i] = 0;
                    this.log.warn("Array ist too short, filling up with start point 0");
                }
            }
            this.sendMessage(`{"mzv":${JSON.stringify(seq)}}`, mower.serial_number, id);
            this.log.debug(`new Array is: ${JSON.stringify(seq)}`);
        } catch (e) {
            this.log.error(`Error while setting start sequence: ${e}`);
        }
    }

    /**
     * @param {string} id
     * @param {any} value
     * @param {object} mower
     */
    mowTimeEx(id, value, mower) {
        const val = value;

        if (
            !mower.last_status ||
            !mower.last_status.payload ||
            !mower.last_status.payload.cfg ||
            !mower.last_status.payload.cfg.sc
        ) {
            // check if config exist
            this.log.warn(
                `Cant send command because cfg.sc is missing from cloud exist please try again later. last message: ${JSON.stringify(
                    mower.last_status,
                )}`,
            );
            return;
        }

        const message = mower.last_status.payload.cfg.sc; // set aktual values
        this.log.debug(`MowerTimeExtend JSON : ${JSON.stringify(message)}`);

        //hotfix 030620
        message && delete message.ots;

        if (!isNaN(val) && val >= -100 && val <= 100) {
            message.p = val;
            this.sendMessage(`{"sc":${JSON.stringify(message)}}`, mower.serial_number, id);
            this.log.debug(`MowerTimeExtend set to : ${message.p}`);
        } else {
            this.log.error("MowerTimeExtend must be a value between -100 and 100");
        }
    }

    /**
     * @param {string} id
     * @param {any} value
     * @param {object} mower
     */
    edgeCutting(id, value, mower) {
        const val = value;

        if (
            !mower.last_status ||
            !mower.last_status.payload ||
            !mower.last_status.payload.cfg ||
            (!mower.last_status.payload.cfg.sc && !mower.last_status.payload.cfg.cut)
        ) {
            // check if config exist
            this.log.warn(
                `Cant send command because cfg.sc is missing from cloud exist please try again later. last message: ${JSON.stringify(
                    mower.last_status,
                )}`,
            );
            return;
        }

        if (
            val === true &&
            mower.last_status.payload &&
            mower.last_status.payload.cfg &&
            mower.last_status.payload.cfg.sc &&
            mower.last_status.payload.cfg.cut &&
            mower.last_status.payload.cfg.cut.b === 0
        ) {
            this.modules[mower.serial_number].edgeCut = true;
            this.sendMessage('{"cut":{"b":1,"z":[]}}', mower.serial_number, id);
        } else if (
            val === true &&
            mower.last_status.payload &&
            mower.last_status.payload.cfg &&
            mower.last_status.payload.cfg.sc &&
            mower.last_status.payload.cfg.sc.ots == null
        ) {
            this.modules[mower.serial_number].edgeCut = true;
            this.sendMessage('{"cmd":4}', mower.serial_number, id); // starte ZoneTraining
        } else if (
            val === true &&
            mower.last_status.payload &&
            mower.last_status.payload.cfg &&
            mower.last_status.payload.cfg.sc &&
            mower.last_status.payload.cfg.sc.ots
        ) {
            this.sendMessage('{"sc":{"ots":{"bc":1,"wtm":0}}}', mower.serial_number, id);
        } else {
            this.log.warn("EdgeCutting is not possible");
        }
    }

    async sendCommand(value, mower, id) {
        const val = value;
        if (val < 0 || val > 9) {
            this.log.info(`Sending cmd:${val} is not allowed.`);
            return;
        }
        this.log.debug(`Send cmd:${val}`);
        this.setState(`${mower.serial_number}.mower.sendCommand`, {
            ack: true,
        });
        this.sendMessage(`{"cmd":${val}}`, mower.serial_number, id);
    }

    async cleanOldVersion(serial) {
        if (this.version == null) this.version = "";
        const cleanOldVersion = await this.getObjectAsync(
            this.name + "." + this.instance + "." + serial + ".oldVersionCleaned",
        );

        if (!cleanOldVersion) {
            this.log.info("Please wait a few minutes.... clean old version");
            await this.delForeignObjectAsync(this.name + "." + this.instance + "." + serial + ".rawMqtt", {
                recursive: true,
            });
            await this.delForeignObjectAsync(this.name + "." + this.instance + "." + serial + ".weather", {
                recursive: true,
            });
            this.log.info("Done with cleaning");
        } else {
            try {
                //Preparation for next Version
                let oldVersion = "2.0.1";
                const oldVerState = await this.getStateAsync(serial + ".oldVersionCleaned");
                if (oldVerState && oldVerState.val) {
                    oldVersion = oldVerState.val.toString();
                }

                if (this.version > oldVersion && oldVersion <= "2.3.1") {
                    let checking;
                    checking = await this.getObjectAsync(serial + ".mower.actualArea");
                    if (checking) {
                        await this.delObjectAsync(serial + ".mower.actualArea");
                        this.log.info(`Delete object ${serial}.mower.actualArea`);
                    }
                    checking = await this.getObjectAsync(serial + ".mower.actualAreaIndicator");
                    if (checking) {
                        await this.delObjectAsync(serial + ".mower.actualAreaIndicator");
                        this.log.info(`Delete object ${serial}.mower.actualAreaIndicator`);
                    }
                    checking = await this.getObjectAsync(serial + ".mower.zoneKeeper");
                    if (checking) {
                        await this.delObjectAsync(serial + ".mower.zoneKeeper");
                        this.log.info(`Delete object ${serial}.mower.zoneKeeper`);
                    }
                }
            } catch (e) {
                this.log.info("cleanOldVersion: " + e);
            }
        }
        const common = {
            name: {
                en: "Version check",
                de: "Versionskontrolle",
                ru: "Проверка версии",
                pt: "Verificação da versão",
                nl: "Versie controle",
                fr: "Vérification de la version",
                it: "Controllo della versione",
                es: "Verificación de la versión",
                pl: "Kontrola",
                uk: "Перевірка версій",
                "zh-cn": "检查",
            },
            type: "string",
            role: "info.firmware",
            write: false,
            read: true,
        };
        await this.createDataPoint(`${serial}.oldVersionCleaned`, common, "state");
        await this.setStateAsync(serial + ".oldVersionCleaned", this.version, true);
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Worx(options);
} else {
    // otherwise start the instance directly
    new Worx();
}
