/**
 Copyright (C) 2017 Yussuf Khalil

 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const Lang = imports.lang;
const St = imports.gi.St;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const MainLoop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;

const LOG_PREFIX = "[SWITCHEROO]";

const lspciCache = {};
let status;

//noinspection JSUnusedGlobalSymbols
function enable() {
    status = new SwitcherooStatusIndicator();
    Main.panel.addToStatusArea("swticheroo-status", status, 0);
}

//noinspection JSUnusedGlobalSymbols
function disable() {
    status.destroy();
    status = null;
}

function log(message) {
    global.log(LOG_PREFIX + " " + message);
}

function GPU(index, type, connected, powerState, busID) {
    this.index = index;
    this.type = type;
    this.connected = connected;
    this.powerState = powerState;
    this.busID = busID;
}

GPU.prototype = {
    get name() {
        // For some strange reason lspci always triggers activation of the dGPU, so let's cache results
        if (lspciCache[this.busID] !== undefined) {
            return lspciCache[this.busID];
        }

        let [success, output] = GLib.spawn_command_line_sync("sh -c \"lspci | grep " + this.busID + "\"");
        if (!success) {
            log("lspci failed");
            return "Unknown";
        }

        output = String(output);

        if (!output.trim().length) {
            log("Unable to find device " + this.busID + " in lspci");
            return "Unknown";
        }

        lspciCache[this.busID] = output.slice(this.busID.length).split(":", 2)[1].trim();
        return lspciCache[this.busID];
    },
    get vendor() {
        return this.name.split(" ", 2)[0];
    }
};

function SwitcherooStatusIndicator() {
    this._init();
}

SwitcherooStatusIndicator.prototype = {
    __proto__: PanelMenu.Button.prototype,
    _init: function () {
        PanelMenu.Button.prototype._init.call(this, St.Align.START);

        this._layout = new St.BoxLayout();
        this._panelIndicator = new St.Label({
            text: "Unknown",
            style_class: "system-status-icon",
            y_align: Clutter.ActorAlign.CENTER
        });
        this._layout.add(this._panelIndicator);
        this.actor.add_actor(this._layout);

        this._timer = MainLoop.timeout_add_seconds(1, Lang.bind(this, this._onTimer));
        this.connect("destroy", Lang.bind(this, this._onDestroy));
    },
    /**
     * @returns GPU[]
     * @private
     */
    get _GPUs() {
        let GPUs = [];

        let [success, output] = GLib.spawn_command_line_sync("pkexec cat /sys/kernel/debug/vgaswitcheroo/switch");
        if (!success) {
            log("Failed to read switcheroo status");
            return [];
        }

        for (let line of String(output).split("\n")) {
            if (!line.length)
                continue;

            // 0:IGD:+:Pwr:0000:00:02.0
            let values = line.match(/^([0-9]):([A-Z]+):([ +]):([A-Za-z]+):[0-9]+:([0-9:\.]+)$/);
            values.shift();
            GPUs.push(new GPU(values[0], values[1], values[2] === "+", values[3], values[4]));
        }

        return GPUs;
    },
    _onDestroy: function () {
        MainLoop.source_remove(this._timer);
    },
    _onTimer: function () {
        let GPUs = this._GPUs;
        let activeGPU;

        for (let GPU of GPUs) {
            if (GPU.powerState.toLowerCase().indexOf("pwr") !== -1) {
                activeGPU = GPU;
            }
        }

        if (activeGPU === undefined) {
            log("Failed to find active GPU");
            this._panelIndicator.text = "Unknown";

            return true;
        }

        this._panelIndicator.text = activeGPU.vendor;

        return true;
    }
};