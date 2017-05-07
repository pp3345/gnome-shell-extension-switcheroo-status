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

function GPU(parameters) {
    this.index = parameters.index;
    this.type = parameters.type;
    this.connected = parameters.connected;
    this.powerState = parameters.powerState;
    this.busID = parameters.busID;
}

GPU.prototype = {
    _lpsci: function() {
        // For some strange reason lspci always triggers activation of the dGPU, so let's cache results
        if (lspciCache[this.busID] !== undefined) {
            return lspciCache[this.busID];
        }

        let [success, output] = GLib.spawn_command_line_sync("lspci -mm -s " + this.busID);
        if (!success) {
            log("lspci failed");
            return "Unknown";
        }

        output = String(output);

        if (!output.trim().length) {
            log("Unable to find device " + this.busID + " in lspci");
            return "Unknown";
        }

        lspciCache[this.busID] = [];
        let regex = /(?:"([A-Za-z0-9\[\]\s]+)")/g;
        let result;

        while ((result = regex.exec(output)) !== null)
            lspciCache[this.busID].push(result[1]);

        return lspciCache[this.busID];
    },
    get name() {
        return this._lpsci()[2];
    },
    get vendor() {
        return this._lpsci()[1];
    }
};

function SwitcherooStatusIndicator() {
    this._init();
}

SwitcherooStatusIndicator.prototype = {
    __proto__: PanelMenu.Button.prototype,
    _menuItems: {},
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
            GPUs.push(new GPU({
                index: values[0],
                type: values[1],
                connected: values[2] === "+",
                powerState: values[3],
                busID: values[4]
            }));
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

            if(this._menuItems[GPU.busID] === undefined) {
                this._menuItems[GPU.busID] = new GPUMenuItem({
                    menu: this.menu,
                    GPU: GPU
                });

                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }

            this._menuItems[GPU.busID].refresh(GPU);
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

function GPUMenuItem(parameters) {
    this.menu = parameters.menu;
    this._init();
}

GPUMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,
    _init: function() {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, {
            style_class: "switcheroo-gpu-menu-item",
            reactive: false
        });

        this._parentBox = new St.BoxLayout({
            x_expand: true,
            style_class: "switcheroo-gpu-menu-item-parent-box"
        });

        this._leftBox = new St.BoxLayout({
            vertical: true,
            style_class: "system-menu-action switcheroo-menu-left-box",
        });
        this._vendorName = new St.Label({
            style_class: "switcheroo-menu-vendor",
        });
        this._gpuName = new St.Label({
            style_class: "switcheroo-menu-gpu"
        });
        this._leftBox.add_actor(this._vendorName);
        this._leftBox.add_actor(this._gpuName);

        this._rightBox = new St.BoxLayout({
            vertical: true,
            style_class: "switcheroo-menu-right-box",
            x_align: Clutter.ActorAlign.END,
            x_expand: true
        });

        this._powerState = new St.Label({
            style_class: "switcheroo-menu-property switcheroo-menu-power-state"
        });
        this._connectedToDisplay = new St.Label({
            style_class: "switcheroo-menu-property switcheroo-menu-connected-to-display"
        });
        this._rightBox.add_actor(this._powerState);
        this._rightBox.add_actor(this._connectedToDisplay);

        this._parentBox.add_actor(this._leftBox);
        this._parentBox.add_actor(this._rightBox);

        this.actor.add_actor(this._parentBox, {expand: true});
        this.menu.addMenuItem(this);
    },
    refresh: function(GPU) {
        this.GPU = GPU;

        this._vendorName.text = this.GPU.vendor;
        this._gpuName.text = this.GPU.name;

        this._connectedToDisplay.text = GPU.connected ? _("Connected to display") : "";
        this._powerState.text = GPU.powerState;
    }
};